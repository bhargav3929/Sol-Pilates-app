import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    getDocs,
    getCountFromServer,
    limit as limitTo,
    startAfter,
    Timestamp,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
    type Unsubscribe,
} from 'firebase/firestore';
import type { GstBreakdown } from '../utils/gst';
import type { PlanDefinition, PlanId, PlanOverride } from '../types/subscription';
import { db, auth } from './config';
import { getApiBaseUrl } from './api-config';
import { UserProfile } from '../types/user';
import { ClassSession, SpotSelection } from '../types/class';
import { Booking } from '../types/booking';
import type { SubscriptionEvent } from '../types/subscriptionEvent';
import { Trainer } from '../types/trainer';
import { AppNotification, NotificationType } from '../types/notification';
import { PushPlatform, PushToken, isExpoPushToken, pushTokenId } from '../types/pushToken';
import { GymCenter } from '../types/gym';
import { byStartTime, isOnStudioDay, studioDayQueryWindow } from '../schedule/studio-day';
import { hasClassEnded } from '../schedule/class-time';

// ---------------------------------------------------------------------------
// API call helper — gets ID token and calls our Next.js API routes
// ---------------------------------------------------------------------------

export async function apiFetch<T>(
    url: string,
    options: { method?: string; body?: unknown } = {},
): Promise<T> {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken();

    const res = await fetch(`${getApiBaseUrl()}${url}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
        throw new ApiError(
            (data.error as string) || 'API request failed',
            (data.code as string) || 'unknown',
            data,
        );
    }
    return data as T;
}

/**
 * Error thrown by apiFetch on a non-2xx response. Carries the API's machine
 * -readable `code` and full payload so callers can branch on the failure
 * (e.g. offering to reassign classes) instead of matching on message text.
 */
export class ApiError extends Error {
    readonly code: string;
    readonly data: Record<string, unknown>;

    constructor(message: string, code: string, data: Record<string, unknown> = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.data = data;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toDate(val: unknown): Date {
    if (val instanceof Timestamp) return val.toDate();
    if (val instanceof Date) return val;
    if (typeof val === 'string' || typeof val === 'number') return new Date(val);
    return new Date();
}

export function convertTimestamps<T extends Record<string, unknown>>(data: T): T {
    const result = { ...data };
    for (const key of Object.keys(result)) {
        const val = result[key];
        if (val instanceof Timestamp) {
            (result as Record<string, unknown>)[key] = val.toDate();
        }
    }
    return result;
}

export type FirestorePageCursor = QueryDocumentSnapshot<DocumentData> | null;

export interface PaginatedResult<T> {
    items: T[];
    nextCursor: FirestorePageCursor;
    total: number;
}

interface PageOptions {
    pageSize: number;
    cursor?: FirestorePageCursor;
}

async function getPage<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    pageSize: number,
    cursor: FirestorePageCursor | undefined,
    mapper: (snapshot: QueryDocumentSnapshot<DocumentData>) => T,
): Promise<PaginatedResult<T>> {
    const baseQuery = query(collection(db, collectionName), ...constraints);
    const countSnap = await getCountFromServer(baseQuery);
    const pageQuery = query(
        collection(db, collectionName),
        ...constraints,
        ...(cursor ? [startAfter(cursor)] : []),
        limitTo(pageSize),
    );
    const snapshot = await getDocs(pageQuery);

    return {
        items: snapshot.docs.map(mapper),
        nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null,
        total: countSnap.data().count,
    };
}

function mapDocWithId<T>(snapshot: QueryDocumentSnapshot<DocumentData>, idField = 'id'): T {
    return convertTimestamps({
        ...snapshot.data(),
        [idField]: snapshot.id,
    }) as unknown as T;
}

// ---------------------------------------------------------------------------
// Class-day helpers — shared by every "classes on a given day" query.
// ---------------------------------------------------------------------------

// A class in either state is still on the schedule. 'ongoing' has to be included
// or a class vanishes from the member schedule the moment the studio starts it.
const ACTIVE_CLASS_STATUSES: ClassSession['status'][] = ['scheduled', 'ongoing'];

// `classes.date` is written as a Timestamp, but tolerate docs that carry a raw
// value rather than throwing and losing the whole day's list.
function readClassDate(data: DocumentData): Date | null {
    const raw = data.date;
    if (raw instanceof Timestamp) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === 'string' || typeof raw === 'number') {
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function isClassOnDay(data: DocumentData, day: Date): boolean {
    const date = readClassDate(data);
    return date !== null && isOnStudioDay(date, day);
}

// ---------------------------------------------------------------------------
// 1. getClassesByDate — Query classes for a given date
// ---------------------------------------------------------------------------

export async function getClassesByDate(date: Date): Promise<ClassSession[]> {
    const { start, end } = studioDayQueryWindow(date);

    const q = query(
        collection(db, 'classes'),
        where('status', 'in', ACTIVE_CLASS_STATUSES),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end)),
        orderBy('date'),
        orderBy('startTime'),
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .filter((doc) => isClassOnDay(doc.data(), date))
        .filter((doc) => {
            const classDate = readClassDate(doc.data());
            return classDate !== null && !hasClassEnded(classDate, doc.data().startTime, doc.data().duration);
        })
        .map((doc) => {
            const data = doc.data();
            return convertTimestamps({ ...data, id: doc.id }) as unknown as ClassSession;
        })
        .sort(byStartTime);
}

// ---------------------------------------------------------------------------
// 1b. getAdminClassesInRange — All classes (any status) within a date range.
//     Used by the admin calendar to populate a month grid + day agenda.
//     Sorted by startTime client-side to avoid a composite index requirement.
// ---------------------------------------------------------------------------

export async function getAdminClassesInRange(rangeStart: Date, rangeEnd: Date): Promise<ClassSession[]> {
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(rangeEnd);
    end.setHours(23, 59, 59, 999);

    const q = query(
        collection(db, 'classes'),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end)),
        orderBy('date'),
    );

    const snapshot = await getDocs(q);
    const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as ClassSession;
    });

    return items.sort((a, b) => {
        const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return (a.startTime || '').localeCompare(b.startTime || '');
    });
}

// ---------------------------------------------------------------------------
// 2. getClassById — Single class document (with optional real-time listener)
// ---------------------------------------------------------------------------

export async function getClassById(classId: string): Promise<ClassSession | null> {
    const docRef = doc(db, 'classes', classId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return convertTimestamps({ ...snap.data(), id: snap.id }) as unknown as ClassSession;
}

// ---------------------------------------------------------------------------
// 3. getUserBookings — User's bookings ordered by classDate desc
// ---------------------------------------------------------------------------

export async function getUserBookings(userId: string): Promise<Booking[]> {
    const q = query(
        collection(db, 'bookings'),
        where('userId', '==', userId),
        orderBy('classDate', 'desc'),
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as Booking;
    });
}

export async function getUserBookingsPage(
    userId: string,
    options: PageOptions & {
        statuses?: Booking['status'][];
        direction?: 'asc' | 'desc';
    },
): Promise<PaginatedResult<Booking>> {
    const constraints: QueryConstraint[] = [
        where('userId', '==', userId),
        ...(options.statuses && options.statuses.length > 0
            ? [where('status', 'in', options.statuses)]
            : []),
        orderBy('classDate', options.direction || 'desc'),
    ];

    const page = await getPage<Booking>(
        'bookings',
        constraints,
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<Booking & { classId: string; trainerId: string }>(snapshot),
    );

    const classIds = Array.from(new Set(page.items.map((b) => b.classId).filter(Boolean)));
    const classEntries = await Promise.all(
        classIds.map(async (id) => {
            const snap = await getDoc(doc(db, 'classes', id));
            return [id, snap.exists() ? snap.data() : {}] as const;
        }),
    );
    const classCache = new Map<string, Record<string, unknown>>(classEntries);

    const trainerIds = Array.from(
        new Set(
            page.items
                .map((b) => (classCache.get(b.classId)?.trainerId as string) || b.trainerId)
                .filter(Boolean),
        ),
    );
    const trainerEntries = await Promise.all(
        trainerIds.map(async (id) => {
            const snap = await getDoc(doc(db, 'trainers', id));
            return [id, snap.exists() ? (snap.data().name as string) : 'Instructor'] as const;
        }),
    );
    const trainerCache = new Map<string, string>(trainerEntries);

    return {
        ...page,
        items: page.items.map((b) => {
            const cls = classCache.get(b.classId) || {};
            const trainerId = (cls.trainerId as string) || b.trainerId;
            return {
                ...b,
                classType: (cls.classType as string) || 'Pilates',
                classStartTime: (cls.startTime as string) || '',
                classDuration: (cls.duration as number) || 0,
                classLocation: (cls.location as string) || 'Group Room',
                trainerName: trainerCache.get(trainerId) || 'Instructor',
            } as Booking;
        }),
    };
}

// ---------------------------------------------------------------------------
// 4. getUserProfile — Enhanced with optional real-time listener
// ---------------------------------------------------------------------------

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) return null;
    return convertTimestamps({ ...userDoc.data(), uid: userDoc.id }) as unknown as UserProfile;
}

export function subscribeToUserProfile(
    uid: string,
    callback: (profile: UserProfile | null) => void,
): Unsubscribe {
    const userRef = doc(db, 'users', uid);
    return onSnapshot(userRef, (snap) => {
        if (!snap.exists()) {
            callback(null);
            return;
        }
        callback(convertTimestamps({ ...snap.data(), uid: snap.id }) as unknown as UserProfile);
    });
}

// ---------------------------------------------------------------------------
// 5. getTrainers — All active trainers
// ---------------------------------------------------------------------------

export async function getTrainers(): Promise<Trainer[]> {
    const q = query(
        collection(db, 'trainers'),
        where('isActive', '==', true),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as Trainer;
    });
}

// ---------------------------------------------------------------------------
// 6. subscribeToClass — Real-time listener for spot availability
// ---------------------------------------------------------------------------

export function subscribeToClass(
    classId: string,
    callback: (classSession: ClassSession | null) => void,
): Unsubscribe {
    const classRef = doc(db, 'classes', classId);
    return onSnapshot(classRef, (snap) => {
        if (!snap.exists()) {
            callback(null);
            return;
        }
        callback(convertTimestamps({ ...snap.data(), id: snap.id }) as unknown as ClassSession);
    });
}

// Real-time listener for all scheduled classes on a given date.
// Fires whenever any class in the day is added, updated (e.g. bookedSpots changes),
// or removed — used by Dashboard's "Today at the Studio" and Schedule tab.
export function subscribeToClassesByDate(
    date: Date,
    callback: (classes: ClassSession[]) => void,
    options: {
        trainerId?: string;
        classType?: string;
        onError?: (error: Error) => void;
    } = {},
): Unsubscribe {
    const { start, end } = studioDayQueryWindow(date);

    const q = query(
        collection(db, 'classes'),
        where('status', 'in', ACTIVE_CLASS_STATUSES),
        ...(options.trainerId ? [where('trainerId', '==', options.trainerId)] : []),
        ...(options.classType ? [where('classType', '==', options.classType)] : []),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end)),
        orderBy('date'),
        orderBy('startTime'),
    );
    return onSnapshot(
        q,
        (snapshot) => {
            const classes = snapshot.docs
                .filter((doc) => isClassOnDay(doc.data(), date))
                .filter((doc) => {
                    const classDate = readClassDate(doc.data());
                    return classDate !== null && !hasClassEnded(classDate, doc.data().startTime, doc.data().duration);
                })
                .map((doc) => {
                    const data = doc.data();
                    return convertTimestamps({ ...data, id: doc.id }) as unknown as ClassSession;
                })
                .sort(byStartTime);
            callback(classes);
        },
        // Without this the listener fails silently and callers sit on a loading
        // spinner forever — a missing index or a rules change reads as a hang.
        (error) => {
            console.error('[subscribeToClassesByDate] listener failed', error);
            options.onError?.(error);
        },
    );
}

// ---------------------------------------------------------------------------
// 7. subscribeToUserBookings — Real-time listener for user bookings
// ---------------------------------------------------------------------------

export function subscribeToUserBookings(
    userId: string,
    callback: (bookings: Booking[]) => void,
): Unsubscribe {
    const q = query(
        collection(db, 'bookings'),
        where('userId', '==', userId),
        orderBy('classDate', 'desc'),
    );
    const classCache = new Map<string, Record<string, unknown>>();
    const trainerCache = new Map<string, string>();

    return onSnapshot(q, async (snapshot) => {
        const rawBookings = snapshot.docs.map((doc) => {
            const data = doc.data();
            return convertTimestamps({ ...data, id: doc.id }) as unknown as Booking & {
                classId: string;
                trainerId: string;
            };
        });

        const classIds = Array.from(new Set(rawBookings.map((b) => b.classId).filter(Boolean)));
        const missingClassIds = classIds.filter((id) => !classCache.has(id));
        await Promise.all(
            missingClassIds.map(async (id) => {
                const snap = await getDoc(doc(db, 'classes', id));
                if (snap.exists()) classCache.set(id, snap.data() as Record<string, unknown>);
                else classCache.set(id, {});
            }),
        );

        const trainerIds = Array.from(
            new Set(
                rawBookings
                    .map((b) => (classCache.get(b.classId)?.trainerId as string) || b.trainerId)
                    .filter(Boolean),
            ),
        );
        const missingTrainerIds = trainerIds.filter((id) => !trainerCache.has(id));
        await Promise.all(
            missingTrainerIds.map(async (id) => {
                const snap = await getDoc(doc(db, 'trainers', id));
                trainerCache.set(id, snap.exists() ? (snap.data().name as string) : 'Instructor');
            }),
        );

        const enriched = rawBookings.map((b) => {
            const cls = classCache.get(b.classId) || {};
            const trainerId = (cls.trainerId as string) || b.trainerId;
            return {
                ...b,
                classType: (cls.classType as string) || 'Pilates',
                classStartTime: (cls.startTime as string) || '',
                classDuration: (cls.duration as number) || 0,
                classLocation: (cls.location as string) || 'Group Room',
                trainerName: trainerCache.get(trainerId) || 'Instructor',
            } as Booking;
        });
        callback(enriched);
    });
}

// ---------------------------------------------------------------------------
// 8. getAllClasses — Admin: all classes
// ---------------------------------------------------------------------------

export async function getAllClasses(): Promise<ClassSession[]> {
    const q = query(
        collection(db, 'classes'),
        orderBy('date', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as ClassSession;
    });
}

export async function getClassesPage(
    options: PageOptions & { status?: ClassSession['status'] },
): Promise<PaginatedResult<ClassSession>> {
    return getPage<ClassSession>(
        'classes',
        [
            ...(options.status ? [where('status', '==', options.status)] : []),
            orderBy('date', 'desc'),
        ],
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<ClassSession>(snapshot),
    );
}

export async function getClassStats(): Promise<{
    totalClasses: number;
    scheduledClasses: number;
    completedClasses: number;
    totalCapacity: number;
}> {
    const snapshot = await getDocs(collection(db, 'classes'));
    let totalClasses = 0;
    let scheduledClasses = 0;
    let completedClasses = 0;
    let totalCapacity = 0;

    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        totalClasses++;
        if (data.status === 'scheduled') scheduledClasses++;
        if (data.status === 'completed') completedClasses++;
        totalCapacity += (data.totalSpots as number) || (data.capacity as number) || 0;
    });

    return {
        totalClasses,
        scheduledClasses,
        completedClasses,
        totalCapacity,
    };
}

// ---------------------------------------------------------------------------
// 9. getAllBookings — Admin: all bookings
// ---------------------------------------------------------------------------

export async function getAllBookings(): Promise<Booking[]> {
    const q = query(
        collection(db, 'bookings'),
        orderBy('classDate', 'desc'),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as Booking;
    });
}

export async function getBookingsPage(
    options: PageOptions & { status?: Booking['status'] },
): Promise<PaginatedResult<Booking>> {
    return getPage<Booking>(
        'bookings',
        [
            ...(options.status ? [where('status', '==', options.status)] : []),
            orderBy('classDate', 'desc'),
        ],
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<Booking>(snapshot),
    );
}

// ---------------------------------------------------------------------------
// 10. getAllMembers — Admin: all user profiles
// ---------------------------------------------------------------------------

export async function getAllMembers(): Promise<UserProfile[]> {
    const snapshot = await getDocs(collection(db, 'users'));
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, uid: doc.id }) as unknown as UserProfile;
    });
}

export async function getMembersPage(
    options: PageOptions & {
        planId?: string;
        status?: UserProfile['subscription']['status'];
    },
): Promise<PaginatedResult<UserProfile>> {
    return getPage<UserProfile>(
        'users',
        [
            ...(options.planId ? [where('subscription.planId', '==', options.planId)] : []),
            ...(options.status ? [where('subscription.status', '==', options.status)] : []),
            orderBy('createdAt', 'desc'),
        ],
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<UserProfile>(snapshot, 'uid'),
    );
}

// ---------------------------------------------------------------------------
// 11. callBookClass — API route wrapper
// ---------------------------------------------------------------------------

export async function callBookClass(
    classId: string,
    spotNumber: number,
    isGuest: boolean,
    guestName?: string,
): Promise<{ success: boolean; bookingId: string }> {
    return apiFetch<{ success: boolean; bookingId: string }>('/api/bookings/book', {
        method: 'POST',
        body: { classId, spotNumber, isGuest, guestName },
    });
}

// ---------------------------------------------------------------------------
// 12. callCancelBooking — API route wrapper
// ---------------------------------------------------------------------------

export async function callCancelBooking(
    bookingId: string,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/bookings/cancel', {
        method: 'POST',
        body: { bookingId },
    });
}

// ---------------------------------------------------------------------------
// callDeleteAccount — irreversibly delete the signed-in user's account.
// Cancels upcoming bookings, anonymizes booking history, deletes profile + auth user.
// ---------------------------------------------------------------------------

export async function callDeleteAccount(options?: {
    appleAuthorizationCode?: string;
}): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/account/delete', {
        method: 'POST',
        body: options,
    });
}

// ---------------------------------------------------------------------------
// 13. callCreateClass — API route wrapper for admin
// ---------------------------------------------------------------------------

interface CreateClassInput {
    trainerId: string;
    date: string;
    startTime: string;
    duration: number;
    capacity: number;
    classType?: string;
    difficultyLevel?: 'beginner' | 'intermediate' | 'advanced';
    equipmentNeeded?: string;
    description?: string;
    totalSpots?: number;
    location?: string;
    intensityLevel?: 1 | 2 | 3;
}

export async function callCreateClass(
    classData: CreateClassInput,
): Promise<{ success: boolean; classId: string }> {
    return apiFetch<{ success: boolean; classId: string }>('/api/classes', {
        method: 'POST',
        body: classData,
    });
}

// ---------------------------------------------------------------------------
// 14. callUpdateClass — API route wrapper for admin
// ---------------------------------------------------------------------------

interface UpdateClassInput extends Partial<CreateClassInput> {
    classId: string;
    status?: 'scheduled' | 'ongoing' | 'completed' | 'canceled';
}

export async function callUpdateClass(
    classData: UpdateClassInput,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/classes', {
        method: 'PUT',
        body: classData,
    });
}

// ---------------------------------------------------------------------------
// 15. callDeleteClass — API route wrapper for admin
// ---------------------------------------------------------------------------

export async function callDeleteClass(
    classId: string,
    cancelReason?: string,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/classes', {
        method: 'DELETE',
        body: { classId, cancelReason },
    });
}

// ---------------------------------------------------------------------------
// 16a. callAdminEnrollMember — Admin enrolls a member into a class
// ---------------------------------------------------------------------------

export async function callAdminEnrollMember(
    classId: string,
    userId: string,
    creditMode: 'available_credit' | 'no_credit' = 'no_credit',
): Promise<{ success: boolean; bookingId: string }> {
    return apiFetch<{ success: boolean; bookingId: string }>('/api/admin/enroll', {
        method: 'POST',
        body: { classId, userId, creditMode },
    });
}

// ---------------------------------------------------------------------------
// 16. callSetAdminRole — API route wrapper
// ---------------------------------------------------------------------------

export async function callSetAdminRole(
    targetUid: string,
    isAdmin: boolean,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/admin/set-role', {
        method: 'POST',
        body: { targetUid, isAdmin },
    });
}

// ---------------------------------------------------------------------------
// 17. callActivateSubscription — API route wrapper (supports both old and new)
// ---------------------------------------------------------------------------

export async function callActivateSubscription(
    planId: string,
): Promise<{ success: boolean; endDate: string }> {
    return apiFetch<{ success: boolean; endDate: string }>('/api/subscriptions/activate', {
        method: 'POST',
        body: { planId },
    });
}

// ---------------------------------------------------------------------------
// 17b. callCreatePaymentIntent — Create a payment intent for subscription
// ---------------------------------------------------------------------------

export async function callCreatePaymentIntent(
    planId: string,
): Promise<{ paymentId: string; clientSecret: string; amount: number; status: string }> {
    return apiFetch<{ paymentId: string; clientSecret: string; amount: number; status: string }>(
        '/api/payments/create-intent',
        { method: 'POST', body: { planId } },
    );
}

// ---------------------------------------------------------------------------
// 17c. callConfirmPayment — Confirm a payment and activate subscription
// ---------------------------------------------------------------------------

export async function callConfirmPayment(
    paymentId: string,
): Promise<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }> {
    return apiFetch<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }>(
        '/api/payments/confirm',
        { method: 'POST', body: { paymentId } },
    );
}

// ---------------------------------------------------------------------------
// 17d. callCreatePaymentOrder — Create a Razorpay order for subscription
// ---------------------------------------------------------------------------

export async function callCreatePaymentOrder(
    planId: string,
    metadata?: Record<string, unknown>,
): Promise<{ orderId: string; paymentId: string; amount: number; currency: string; key: string }> {
    return apiFetch<{ orderId: string; paymentId: string; amount: number; currency: string; key: string }>(
        '/api/payments/create-order',
        { method: 'POST', body: { planId, metadata } },
    );
}

// ---------------------------------------------------------------------------
// 17e. callVerifyPayment — Verify Razorpay signature and activate subscription
// ---------------------------------------------------------------------------

export async function callVerifyPayment(payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    paymentId: string;
}): Promise<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }> {
    return apiFetch<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }>(
        '/api/payments/verify',
        { method: 'POST', body: payload },
    );
}

// ---------------------------------------------------------------------------
// 17f. callCreateRazorpaySubscription — Create recurring membership subscription
// ---------------------------------------------------------------------------

export async function callCreateRazorpaySubscription(
    planId: string,
): Promise<{ subscriptionId: string; paymentId: string; amount: number; currency: string; key: string; status: string }> {
    return apiFetch<{ subscriptionId: string; paymentId: string; amount: number; currency: string; key: string; status: string }>(
        '/api/payments/create-subscription',
        { method: 'POST', body: { planId } },
    );
}

// ---------------------------------------------------------------------------
// 17g. callVerifyRazorpaySubscription — Verify subscription checkout
// ---------------------------------------------------------------------------

export async function callVerifyRazorpaySubscription(payload: {
    razorpay_subscription_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    paymentId: string;
}): Promise<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }> {
    return apiFetch<{ success: boolean; endDate: string; planId: string; planName: string; credits: number | null }>(
        '/api/payments/verify-subscription',
        { method: 'POST', body: payload },
    );
}

// ---------------------------------------------------------------------------
// 17h. callAbandonRazorpaySubscription — Cancel abandoned subscription checkout
// ---------------------------------------------------------------------------

export async function callAbandonRazorpaySubscription(payload: {
    subscriptionId: string;
    paymentId: string;
}): Promise<{ success: boolean; razorpayCancelled?: boolean; skipped?: boolean; status?: string }> {
    return apiFetch<{ success: boolean; razorpayCancelled?: boolean; skipped?: boolean; status?: string }>(
        '/api/payments/abandon-subscription',
        { method: 'POST', body: payload },
    );
}

// ---------------------------------------------------------------------------
// 17i. callUpdateRazorpaySubscription — Upgrade/downgrade current subscription
// ---------------------------------------------------------------------------

export async function callUpdateRazorpaySubscription(
    planId: string,
): Promise<{ success: boolean; mode: 'immediate' | 'scheduled'; planId: string; planName: string; effectiveAt: string | null; endDate: string; status: string }> {
    return apiFetch<{ success: boolean; mode: 'immediate' | 'scheduled'; planId: string; planName: string; effectiveAt: string | null; endDate: string; status: string }>(
        '/api/subscriptions/update',
        { method: 'POST', body: { planId } },
    );
}

// ---------------------------------------------------------------------------
// 17j. callSyncRazorpaySubscription — Pull current Razorpay state into Firestore
// ---------------------------------------------------------------------------

export async function callSyncRazorpaySubscription(): Promise<{ success: boolean; planId: string; status: string; razorpayStatus: string; endDate: string | null }> {
    return apiFetch<{ success: boolean; planId: string; status: string; razorpayStatus: string; endDate: string | null }>(
        '/api/subscriptions/sync',
        { method: 'POST' },
    );
}

// ---------------------------------------------------------------------------
// 17k. callCancelSubscription — Cancel the current subscription
// ---------------------------------------------------------------------------

export interface CancelSubscriptionResult {
    success: boolean;
    /** after_next_charge: less than the notice period was given, one more cycle is billed. */
    mode?: 'immediate' | 'period_end' | 'after_next_charge';
    nextChargeAt?: string;
}

export async function callCancelSubscription(): Promise<CancelSubscriptionResult> {
    return apiFetch<CancelSubscriptionResult>('/api/subscriptions/cancel', { method: 'POST' });
}

/** Withdraws a cancellation that is still waiting on the next charge. */
export async function callWithdrawCancellation(): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/subscriptions/cancel', { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 17k-2. Plan freeze - schedule, start or end a freeze (see /policies#membership-freeze)
// ---------------------------------------------------------------------------

export interface FreezePlanResult {
    success: boolean;
    freezeStartDate: string;
    freezeEndDate: string;
    endDate: string;
    canceledBookings: number;
}

/** startDate is the studio calendar day (YYYY-MM-DD). userId lets an admin act for a member. */
export async function callFreezePlan(
    input: { startDate: string; days: number; userId?: string },
): Promise<FreezePlanResult> {
    return apiFetch<FreezePlanResult>('/api/subscriptions/freeze', { method: 'POST', body: input });
}

export async function callEndFreeze(
    input: { userId?: string } = {},
): Promise<{ success: boolean; endDate: string; usedDays: number; unusedDays: number }> {
    return apiFetch('/api/subscriptions/freeze', { method: 'DELETE', body: input });
}

// ---------------------------------------------------------------------------
// 17l. callGetSubscriptionPortalLink — Get Razorpay subscription management URL
// ---------------------------------------------------------------------------

export async function callGetSubscriptionPortalLink(): Promise<{ url: string; status: string }> {
    return apiFetch<{ url: string; status: string }>('/api/subscriptions/portal-link', { method: 'GET' });
}

// ---------------------------------------------------------------------------
// 17m. callGetPricing — Fetch live Razorpay pricing
// ---------------------------------------------------------------------------

export async function callGetPricing(): Promise<{
    plans: Array<{
        planId: string;
        name: string;
        price: number;
        foundingPrice: number | null;
        razorpayPlanId: string | null;
        foundingRazorpayPlanId: string | null;
        razorpayItemId: string | null;
        configured: boolean;
        foundingConfigured: boolean;
        category: string;
        source: 'plans' | 'items' | 'static';
        /** Server-derived charge split so every surface quotes the checkout figure. */
        charge?: GstBreakdown;
        foundingCharge?: GstBreakdown | null;
    }>;
    lastSyncedAt: string | null;
    source: 'plans' | 'items' | 'static';
    /** Effective plan catalog (defaults + admin overrides). Absent from older servers. */
    catalog?: PlanDefinition[];
}> {
    // Public endpoint — no auth needed
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/subscriptions/pricing`);
    if (!res.ok) throw new Error('Failed to fetch pricing');
    return res.json() as Promise<{
        plans: Array<{
            planId: string;
            name: string;
            price: number;
            foundingPrice: number | null;
            razorpayPlanId: string | null;
            foundingRazorpayPlanId: string | null;
            razorpayItemId: string | null;
            configured: boolean;
            foundingConfigured: boolean;
            category: string;
            source: 'plans' | 'items' | 'static';
            charge?: GstBreakdown;
            foundingCharge?: GstBreakdown | null;
        }>;
        lastSyncedAt: string | null;
        source: 'plans' | 'items' | 'static';
        catalog?: PlanDefinition[];
    }>;
}

// ---------------------------------------------------------------------------
// 17n. Admin plan catalog — edit packages and pricing from the admin panel
// ---------------------------------------------------------------------------

export interface AdminPlanRazorpayStatus {
    razorpayPlanId: string | null;
    foundingRazorpayPlanId: string | null;
    /** Amount the live Razorpay plan charges, in paise (GST-inclusive). */
    amountPaise: number | null;
    foundingAmountPaise: number | null;
    /** True when the Razorpay plan amount matches the effective catalog price + GST. */
    inSync: boolean;
    lastSyncedAt: string | null;
}

export interface AdminPlanEntry {
    plan: PlanDefinition;
    defaults: PlanDefinition;
    override: PlanOverride | null;
    razorpay: AdminPlanRazorpayStatus | null;
}

export interface AdminPlanHistoryEntry {
    id: string;
    planId: string;
    action: 'update' | 'reset';
    changes: Record<string, { from: unknown; to: unknown }>;
    razorpayPlanIds?: Record<string, string>;
    adminEmail: string | null;
    createdAt: string | null;
}

export interface AdminPlansResponse {
    plans: AdminPlanEntry[];
    history: AdminPlanHistoryEntry[];
    razorpayMode: 'live' | 'test' | 'unconfigured';
}

export async function callAdminGetPlans(): Promise<AdminPlansResponse> {
    return apiFetch<AdminPlansResponse>('/api/admin/plans');
}

export async function callAdminUpdatePlan(
    planId: PlanId,
    override: PlanOverride,
): Promise<{ success: boolean; plan: AdminPlanEntry; razorpayPlanIds?: Record<string, string> }> {
    return apiFetch('/api/admin/plans', { method: 'PUT', body: { planId, override } });
}

export async function callAdminResetPlan(
    planId: PlanId,
): Promise<{ success: boolean; plan: AdminPlanEntry; razorpayPlanIds?: Record<string, string> }> {
    return apiFetch(`/api/admin/plans?planId=${encodeURIComponent(planId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// 18. getBookingStats — Admin dashboard aggregate
// ---------------------------------------------------------------------------

export async function getBookingStats(): Promise<{
    totalBookings: number;
    confirmedBookings: number;
    canceledBookings: number;
    attendedBookings: number;
    noShowBookings: number;
    todayBookings: number;
}> {
    const allBookingsSnap = await getDocs(collection(db, 'bookings'));
    let totalBookings = 0;
    let confirmedBookings = 0;
    let canceledBookings = 0;
    let attendedBookings = 0;
    let noShowBookings = 0;
    let todayBookings = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    allBookingsSnap.docs.forEach((doc) => {
        const data = doc.data();
        totalBookings++;

        switch (data.status) {
            case 'confirmed':
                confirmedBookings++;
                break;
            case 'canceled':
                canceledBookings++;
                break;
            case 'attended':
                attendedBookings++;
                break;
            case 'no-show':
                noShowBookings++;
                break;
        }

        const classDate = toDate(data.classDate);
        if (classDate >= today && classDate < tomorrow) {
            todayBookings++;
        }
    });

    return {
        totalBookings,
        confirmedBookings,
        canceledBookings,
        attendedBookings,
        noShowBookings,
        todayBookings,
    };
}

// ---------------------------------------------------------------------------
// 19. createUserProfile — Create user profile doc
// ---------------------------------------------------------------------------

export async function createUserProfile(user: UserProfile): Promise<void> {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, user);
}

// ---------------------------------------------------------------------------
// 20. getAllTrainers — Admin: all trainers (including inactive)
// ---------------------------------------------------------------------------

export async function getAllTrainers(): Promise<Trainer[]> {
    const snapshot = await getDocs(collection(db, 'trainers'));
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return convertTimestamps({ ...data, id: doc.id }) as unknown as Trainer;
    });
}

export async function getTrainersPage(
    options: PageOptions,
): Promise<PaginatedResult<Trainer>> {
    return getPage<Trainer>(
        'trainers',
        [orderBy('name')],
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<Trainer>(snapshot),
    );
}

export async function getCollectionPage<T>(
    collectionName: string,
    options: PageOptions & {
        orderField: string;
        orderDirection?: 'asc' | 'desc';
        filters?: Array<{ field: string; op: '==' | 'in'; value: unknown }>;
    },
): Promise<PaginatedResult<T>> {
    return getPage<T>(
        collectionName,
        [
            ...(options.filters || []).map((filter) => where(filter.field, filter.op, filter.value)),
            orderBy(options.orderField, options.orderDirection || 'desc'),
        ],
        options.pageSize,
        options.cursor,
        (snapshot) => mapDocWithId<T>(snapshot),
    );
}

// ---------------------------------------------------------------------------
// 22. callCreateTrainer — API route wrapper for admin
// ---------------------------------------------------------------------------

interface CreateTrainerInput {
    name: string;
    email: string;
    phone?: string;
    bio?: string;
    certifications?: string[];
    specialties?: string[];
    profilePictureUrl?: string;
    experienceYears?: number;
    rating?: number;
}

export async function callCreateTrainer(
    trainerData: CreateTrainerInput,
): Promise<{ success: boolean; trainerId: string }> {
    return apiFetch<{ success: boolean; trainerId: string }>('/api/admin/trainers', {
        method: 'POST',
        body: trainerData,
    });
}

// ---------------------------------------------------------------------------
// 23. callUpdateTrainer — API route wrapper for admin
// ---------------------------------------------------------------------------

interface UpdateTrainerInput extends Partial<CreateTrainerInput> {
    trainerId: string;
    isActive?: boolean;
}

export async function callUpdateTrainer(
    trainerData: UpdateTrainerInput,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/admin/trainers', {
        method: 'PUT',
        body: trainerData,
    });
}

// ---------------------------------------------------------------------------
// 24. callDeleteTrainer — API route wrapper for admin (hard delete)
// ---------------------------------------------------------------------------

/**
 * Deletes a trainer. If the trainer still has classes assigned, the API rejects
 * with code 'trainer-has-classes' unless reassignToTrainerId is supplied, in
 * which case those classes and their bookings move to the replacement first.
 */
export async function callDeleteTrainer(
    trainerId: string,
    reassignToTrainerId?: string,
): Promise<{ success: boolean; reassignedClasses: number }> {
    return apiFetch<{ success: boolean; reassignedClasses: number }>('/api/admin/trainers', {
        method: 'DELETE',
        body: { trainerId, ...(reassignToTrainerId ? { reassignToTrainerId } : {}) },
    });
}

// ---------------------------------------------------------------------------
// 24a. callCreateMember / callDeleteMember — admin member management
// ---------------------------------------------------------------------------

export interface CreateMemberInput {
    name: string;
    email: string;
    phone?: string;
    age?: number;
    password?: string;
}

export async function callCreateMember(
    member: CreateMemberInput,
): Promise<{ success: boolean; uid: string }> {
    return apiFetch<{ success: boolean; uid: string }>('/api/admin/members', {
        method: 'POST',
        body: member,
    });
}

export async function callDeleteMember(
    userId: string,
): Promise<{ success: boolean; deletedBookings: number; releasedClasses: number }> {
    return apiFetch<{ success: boolean; deletedBookings: number; releasedClasses: number }>(
        '/api/admin/members',
        { method: 'DELETE', body: { userId } },
    );
}

export interface AdminSubscriptionEdit {
    userId: string;
    reason: string;
    planId?: string;
    classesRemaining?: number | null;
    introCreditRemaining?: number;
    guestPassesRemaining?: number;
    /** Last studio day of access, YYYY-MM-DD. */
    endDate?: string;
    status?: 'active' | 'expired' | 'canceled';
}

export async function callAdminUpdateMemberSubscription(
    edit: AdminSubscriptionEdit,
): Promise<{ success: boolean; changes: Record<string, unknown> }> {
    return apiFetch('/api/admin/members/subscription', { method: 'PATCH', body: edit });
}

export interface MemberPaymentSummary {
    id: string;
    planId: string | null;
    planName: string | null;
    status: string | null;
    amount: number | null;
    totalPaise: number | null;
    currency: string | null;
    razorpayPaymentId: string | null;
    razorpayOrderId: string | null;
    razorpaySubscriptionId: string | null;
    grantedBy: string | null;
    needsReview: boolean;
    reviewReason: string | null;
    createdAt: string | null;
    paidAt: string | null;
}

/** Subscription ledger for one member, newest first, with their payments. */
export async function getMemberSubscriptionEvents(
    userId: string,
    limit = 100,
): Promise<{ events: SubscriptionEvent[]; payments: MemberPaymentSummary[] }> {
    const params = new URLSearchParams({ userId, limit: String(limit) });
    return apiFetch<{ events: SubscriptionEvent[]; payments: MemberPaymentSummary[] }>(
        `/api/admin/members/events?${params.toString()}`,
    );
}

// ---------------------------------------------------------------------------
// 25. getFacility — Get the single gym center from Firestore
// ---------------------------------------------------------------------------

export async function getFacility(): Promise<GymCenter | null> {
    const snapshot = await getDocs(collection(db, 'gymCenters'));
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return convertTimestamps({ ...doc.data(), id: doc.id }) as unknown as GymCenter;
}

// ---------------------------------------------------------------------------
// 26. callUpdateFacility — API route wrapper for admin
// ---------------------------------------------------------------------------

interface UpdateFacilityInput {
    facilityId: string;
    name?: string;
    address?: GymCenter['address'];
    coordinates?: GymCenter['coordinates'];
    contactInfo?: GymCenter['contactInfo'];
    operatingHours?: GymCenter['operatingHours'];
    facilities?: string;
    photos?: string[];
    isActive?: boolean;
}

export async function callUpdateFacility(
    facilityData: UpdateFacilityInput,
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/admin/facility', {
        method: 'PUT',
        body: facilityData,
    });
}

// ---------------------------------------------------------------------------
// 27. Real-time listeners for admin pages
// ---------------------------------------------------------------------------

export function subscribeToAllClasses(
    callback: (classes: ClassSession[]) => void,
): Unsubscribe {
    const q = query(
        collection(db, 'classes'),
        orderBy('date', 'desc'),
    );
    return onSnapshot(q, (snapshot) => {
        const classes = snapshot.docs.map((d) => {
            const data = d.data();
            return convertTimestamps({ ...data, id: d.id }) as unknown as ClassSession;
        });
        callback(classes);
    });
}

export function subscribeToAllBookings(
    callback: (bookings: Booking[]) => void,
): Unsubscribe {
    const q = query(
        collection(db, 'bookings'),
        orderBy('classDate', 'desc'),
    );
    return onSnapshot(q, (snapshot) => {
        const bookings = snapshot.docs.map((d) => {
            const data = d.data();
            return convertTimestamps({ ...data, id: d.id }) as unknown as Booking;
        });
        callback(bookings);
    });
}

export function subscribeToTrainers(
    callback: (trainers: Trainer[]) => void,
    activeOnly = false,
): Unsubscribe {
    const q = activeOnly
        ? query(collection(db, 'trainers'), where('isActive', '==', true))
        : query(collection(db, 'trainers'));
    return onSnapshot(q, (snapshot) => {
        const trainers = snapshot.docs.map((d) => {
            const data = d.data();
            return convertTimestamps({ ...data, id: d.id }) as unknown as Trainer;
        });
        callback(trainers);
    });
}

// ---------------------------------------------------------------------------
// 28. Report stats — computed from Firestore data
// ---------------------------------------------------------------------------

export interface MembershipDistribution {
    name: string;
    value: number;
    color: string;
}

export async function getMembershipDistribution(): Promise<MembershipDistribution[]> {
    const snapshot = await getDocs(collection(db, 'users'));
    const planCounts: Record<string, number> = {};

    snapshot.docs.forEach((d) => {
        const data = d.data();
        const planId = data.subscription?.planId || data.subscription?.planType || null;
        if (planId) {
            planCounts[planId] = (planCounts[planId] || 0) + 1;
        }
    });

    const colors: Record<string, string> = {
        unlimited: '#8B3F2C',
        twice_weekly: '#6B7752',
        once_weekly: '#D4B494',
        drop_in: '#9B7653',
        five_pack: '#556B2F',
        ten_pack: '#8B6914',
    };

    return Object.entries(planCounts).map(([name, value]) => ({
        name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value,
        color: colors[name] || '#888888',
    }));
}

export interface ClassPopularityItem {
    name: string;
    bookings: number;
}

export async function getClassPopularity(): Promise<ClassPopularityItem[]> {
    const snapshot = await getDocs(collection(db, 'classes'));
    const typeMap: Record<string, number> = {};

    snapshot.docs.forEach((d) => {
        const data = d.data();
        const classType = (data.classType as string) || 'Unknown';
        const booked = (data.bookedCount as number) || 0;
        typeMap[classType] = (typeMap[classType] || 0) + booked;
    });

    return Object.entries(typeMap)
        .map(([name, bookings]) => ({ name, bookings }))
        .sort((a, b) => b.bookings - a.bookings)
        .slice(0, 8);
}

export interface LocationUtilization {
    name: string;
    bookings: number;
    utilization: number;
}

export async function getLocationUtilization(): Promise<LocationUtilization[]> {
    const snapshot = await getDocs(collection(db, 'classes'));
    const locationMap: Record<string, { booked: number; capacity: number }> = {};

    snapshot.docs.forEach((d) => {
        const data = d.data();
        const location = (data.location as string) || 'Group Room';
        const booked = (data.bookedCount as number) || 0;
        const capacity = (data.totalSpots as number) || (data.capacity as number) || 12;

        if (!locationMap[location]) {
            locationMap[location] = { booked: 0, capacity: 0 };
        }
        locationMap[location].booked += booked;
        locationMap[location].capacity += capacity;
    });

    return Object.entries(locationMap)
        .map(([name, stats]) => ({
            name,
            bookings: stats.booked,
            utilization: stats.capacity > 0 ? Math.round((stats.booked / stats.capacity) * 100) : 0,
        }))
        .sort((a, b) => b.bookings - a.bookings);
}

export interface AttendanceStats {
    totalAttended: number;
    totalClasses: number;
    avgAttendanceRate: number;
    thisMonthClasses: number;
    activeMembers: number;
}

export async function getAttendanceStats(): Promise<AttendanceStats> {
    const [bookingsSnap, classesSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'classes')),
        getDocs(collection(db, 'users')),
    ]);

    const totalAttended = bookingsSnap.docs.filter(
        (d) => d.data().status === 'attended',
    ).length;

    const totalClasses = classesSnap.size;

    const totalCapacity = classesSnap.docs.reduce(
        (sum, d) => sum + ((d.data().totalSpots as number) || (d.data().capacity as number) || 0),
        0,
    );

    const totalBooked = classesSnap.docs.reduce(
        (sum, d) => sum + ((d.data().bookedCount as number) || 0),
        0,
    );

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthClasses = classesSnap.docs.filter((d) => {
        const dateVal = d.data().date;
        const date = toDate(dateVal);
        return date >= startOfMonth && date <= now;
    }).length;

    const activeMembers = usersSnap.docs.filter(
        (d) => d.data().subscription?.status === 'active',
    ).length;

    return {
        totalAttended,
        totalClasses,
        avgAttendanceRate: totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0,
        thisMonthClasses,
        activeMembers,
    };
}

// ---------------------------------------------------------------------------
// 29. callUpdateUserProfile — Admin: update member profile
// ---------------------------------------------------------------------------

export async function callUpdateUserProfile(
    uid: string,
    updates: Partial<Pick<UserProfile, 'name' | 'age' | 'fitnessGoals'>>,
): Promise<void> {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, { ...updates, updatedAt: new Date() }, { merge: true });
}

// ---------------------------------------------------------------------------
// 29b. subscribeToCheckinClasses — Today's active classes for the check-in panel
//      Includes 'scheduled' AND 'ongoing' (unlike subscribeToClassesByDate which
//      only returns 'scheduled'). Filters out 'canceled' and 'completed' client-side
//      to avoid needing an extra composite index on status + date.
// ---------------------------------------------------------------------------

export function subscribeToCheckinClasses(
    date: Date,
    callback: (classes: ClassSession[]) => void,
): Unsubscribe {
    const { start, end } = studioDayQueryWindow(date);

    const q = query(
        collection(db, 'classes'),
        where('date', '>=', Timestamp.fromDate(start)),
        where('date', '<=', Timestamp.fromDate(end)),
        orderBy('date'),
        orderBy('startTime'),
    );

    return onSnapshot(
        q,
        (snapshot) => {
            const classes = snapshot.docs
                .filter((d) => isClassOnDay(d.data(), date))
                .map((d) => {
                    const data = d.data();
                    return convertTimestamps({ ...data, id: d.id }) as unknown as ClassSession;
                })
                .filter((cls) => cls.status !== 'canceled' && cls.status !== 'completed')
                .sort(byStartTime);
            callback(classes);
        },
        (error) => {
            console.error('[subscribeToCheckinClasses] listener failed', error);
        },
    );
}

// ---------------------------------------------------------------------------
// 30. subscribeToBookingsByClass — Real-time attendee list for a class (admin check-in)
// ---------------------------------------------------------------------------

export function subscribeToBookingsByClass(
    classId: string,
    callback: (bookings: Booking[]) => void,
): Unsubscribe {
    const q = query(
        collection(db, 'bookings'),
        where('classId', '==', classId),
    );
    return onSnapshot(q, (snapshot) => {
        const bookings = snapshot.docs.map((d) => {
            const data = d.data();
            return convertTimestamps({ ...data, id: d.id }) as unknown as Booking;
        });
        callback(bookings);
    });
}

// ---------------------------------------------------------------------------
// 31. callCheckInBooking — Mark a booking as attended or no-show.
// Members may mark their own booking attended during the check-in window;
// admins may mark attended/no-show.
// ---------------------------------------------------------------------------

export async function callCheckInBooking(
    bookingId: string,
    action: 'attended' | 'no-show',
): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>('/api/bookings/checkin', {
        method: 'POST',
        body: { bookingId, action },
    });
}

// ---------------------------------------------------------------------------
// 32. getClassesByIds — Fetch several classes at once into an id -> class map.
// Used wherever a list of bookings needs to show which class each one is for.
// ---------------------------------------------------------------------------

export async function getClassesByIds(
    classIds: string[],
): Promise<Map<string, ClassSession>> {
    const unique = Array.from(new Set(classIds.filter(Boolean)));
    if (unique.length === 0) return new Map();

    const entries = await Promise.all(
        unique.map(async (id) => {
            const snap = await getDoc(doc(db, 'classes', id));
            if (!snap.exists()) return null;
            const cls = convertTimestamps({
                ...snap.data(),
                id: snap.id,
            }) as unknown as ClassSession;
            return [id, cls] as const;
        }),
    );

    return new Map(
        entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    );
}

// ---------------------------------------------------------------------------
// 33. getBookingsByUserIds — Bookings for a set of users, newest class first.
// Firestore caps `in` filters at 30 values, so the ids are queried in chunks
// and merged. Admin-only in practice: the rules let admins read all bookings.
// ---------------------------------------------------------------------------

const IN_FILTER_CHUNK_SIZE = 30;

export async function getBookingsByUserIds(
    userIds: string[],
    options: { status?: Booking['status'] } = {},
): Promise<Booking[]> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return [];

    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += IN_FILTER_CHUNK_SIZE) {
        chunks.push(unique.slice(i, i + IN_FILTER_CHUNK_SIZE));
    }

    const results = await Promise.all(
        chunks.map(async (chunk) => {
            const q = query(
                collection(db, 'bookings'),
                where('userId', 'in', chunk),
                ...(options.status ? [where('status', '==', options.status)] : []),
                orderBy('classDate', 'desc'),
            );
            const snapshot = await getDocs(q);
            return snapshot.docs.map((d) => mapDocWithId<Booking>(d));
        }),
    );

    return results
        .flat()
        .sort((a, b) => toDate(b.classDate).getTime() - toDate(a.classDate).getTime());
}

// ---------------------------------------------------------------------------
// 33b. getEarliestBookingsPerUser — Each user's first few bookings.
// One bounded query per user rather than one `in` query for the batch: an `in`
// query cannot limit per user, so a single converted member with hundreds of
// bookings would otherwise dominate (and pay for) the whole read.
// Ascending order because a lead's demo class is always their first booking —
// the drop-in plan cannot book anything else.
// ---------------------------------------------------------------------------

export async function getEarliestBookingsPerUser(
    userIds: string[],
    perUser: number,
): Promise<Map<string, Booking[]>> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return new Map();

    const entries = await Promise.all(
        unique.map(async (userId) => {
            const snapshot = await getDocs(
                query(
                    collection(db, 'bookings'),
                    where('userId', '==', userId),
                    orderBy('classDate', 'asc'),
                    // One extra so the caller can tell "exactly perUser" from "more"
                    limitTo(perUser + 1),
                ),
            );
            return [userId, snapshot.docs.map((d) => mapDocWithId<Booking>(d))] as const;
        }),
    );

    return new Map(entries);
}

// ---------------------------------------------------------------------------
// 34. getBookingsByClassId — Every booking for one class (admin lookup by id).
// No orderBy so this needs only the automatic single-field index; the caller
// gets them sorted by spot number instead.
// ---------------------------------------------------------------------------

export async function getBookingsByClassId(classId: string): Promise<Booking[]> {
    if (!classId) return [];
    const snapshot = await getDocs(
        query(collection(db, 'bookings'), where('classId', '==', classId)),
    );
    return snapshot.docs
        .map((d) => mapDocWithId<Booking>(d))
        .sort((a, b) => (a.spotNumber ?? 0) - (b.spotNumber ?? 0));
}

// ---------------------------------------------------------------------------
// Notifications — in-app inbox
// ---------------------------------------------------------------------------

const NOTIFICATIONS_FEED_LIMIT = 50;

function mapNotification(snapshot: QueryDocumentSnapshot<DocumentData>): AppNotification {
    return convertTimestamps({
        ...snapshot.data(),
        id: snapshot.id,
    }) as unknown as AppNotification;
}

/** One-shot read of the signed-in user's most recent notifications. */
export async function getUserNotifications(userId: string): Promise<AppNotification[]> {
    const q = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limitTo(NOTIFICATIONS_FEED_LIMIT),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(mapNotification);
}

/**
 * Live subscription to the user's notifications, newest first. Returns the
 * unsubscribe function - call it on unmount.
 */
export function subscribeToUserNotifications(
    userId: string,
    onChange: (notifications: AppNotification[]) => void,
    onError?: (error: Error) => void,
): Unsubscribe {
    const q = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limitTo(NOTIFICATIONS_FEED_LIMIT),
    );
    return onSnapshot(
        q,
        (snapshot) => onChange(snapshot.docs.map(mapNotification)),
        (error) => onError?.(error),
    );
}

export async function markNotificationRead(notificationId: string): Promise<void> {
    await updateDoc(doc(db, 'notifications', notificationId), {
        read: true,
        readAt: Timestamp.now(),
    });
}

/** Marks every unread notification in the given list as read. */
export async function markAllNotificationsRead(
    notifications: AppNotification[],
): Promise<void> {
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => markNotificationRead(n.id)));
}

// ---------------------------------------------------------------------------
// Push tokens — one document per device
// ---------------------------------------------------------------------------

function pushTokensCollection(userId: string) {
    return collection(db, 'users', userId, 'pushTokens');
}

/**
 * Records an Expo push token for the signed-in member's device.
 *
 * The document ID is derived from the token, so re-registering the same device
 * refreshes `updatedAt` instead of accumulating duplicates. Tokens rotate on
 * reinstall and OS-level restore, which is why registration runs on every
 * launch rather than once at signup.
 */
export async function registerPushToken(
    userId: string,
    token: string,
    platform: PushPlatform,
    deviceName?: string | null,
): Promise<void> {
    if (!isExpoPushToken(token)) {
        throw new Error(`Not an Expo push token: ${token}`);
    }

    const id = pushTokenId(token);
    const ref = doc(db, 'users', userId, 'pushTokens', id);
    const now = Timestamp.now();
    const existing = await getDoc(ref);

    await setDoc(
        ref,
        {
            id,
            token,
            platform,
            deviceName: deviceName ?? null,
            // Keep the first-seen date so a stale device is recognisable.
            createdAt: existing.exists() ? existing.data().createdAt ?? now : now,
            updatedAt: now,
        },
        { merge: true },
    );
}

export async function getPushTokens(userId: string): Promise<PushToken[]> {
    const snapshot = await getDocs(pushTokensCollection(userId));
    return snapshot.docs.map((d) => convertTimestamps({ ...d.data(), id: d.id }) as unknown as PushToken);
}

// ---------------------------------------------------------------------------
// callSendAnnouncement — admin broadcast to members
// ---------------------------------------------------------------------------

export interface SendAnnouncementInput {
    title: string;
    body: string;
    /**
     * 'all' = every member, 'active' = active subscriptions only,
     * 'demo_pending' = signed-up members with no purchased plan yet,
     * 'custom' = the provided memberIds only.
     */
    audience: 'all' | 'active' | 'demo_pending' | 'custom';
    memberIds?: string[];
    link?: string;
}

export async function callSendAnnouncement(
    input: SendAnnouncementInput,
): Promise<{ success: boolean; recipients: number }> {
    return apiFetch<{ success: boolean; recipients: number }>('/api/admin/notifications', {
        method: 'POST',
        body: input,
    });
}

export type { AppNotification, NotificationType };
export type { PushToken, PushPlatform };

// ---------------------------------------------------------------------------
// Re-export SpotSelection for convenience
// ---------------------------------------------------------------------------

export type { SpotSelection };
