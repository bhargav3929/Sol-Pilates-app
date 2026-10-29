import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { recordSubscriptionEvent, subscriptionChanges } from '@/lib/subscription-events';
import { FRESH_PLAN_POLICY_STATE } from '@/lib/subscriptions/billing';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { STUDIO_UTC_OFFSET_MINUTES } from '@fitconnect/shared/schedule/studio-day';

// ---------------------------------------------------------------------------
// PATCH - admin edits a member's plan, credits, validity or status.
//
// Body: { userId, reason, planId?, classesRemaining?, introCreditRemaining?,
//         guestPassesRemaining?, endDate? (YYYY-MM-DD, studio day), status? }
//
// planId grants that plan fresh (for cash or offline payments and comps), with
// the plan's credits and validity unless those are also given. Every edit is
// written to the subscriptionEvents ledger with the admin's reason.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['active', 'expired', 'canceled'] as const;

type HttpError = { status: number; error: string; code: string };

function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** End of the given studio day (23:59:59.999 IST), so the plan covers that whole day. */
function endOfStudioDay(dayKey: string): Date {
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1) - STUDIO_UTC_OFFSET_MINUTES * 60_000 - 1);
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999;
}

export async function PATCH(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Must be logged in', code: 'unauthenticated' }, { status: 401 });
        }
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        if (!decoded.admin) {
            return NextResponse.json({ error: 'Admin access required', code: 'permission-denied' }, { status: 403 });
        }

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid request body', code: 'invalid-argument' }, { status: 400 });
        }

        const { userId, reason, planId, classesRemaining, introCreditRemaining, guestPassesRemaining, endDate, status } = body;
        const invalid = (error: string) => NextResponse.json({ error, code: 'invalid-argument' }, { status: 400 });

        if (typeof userId !== 'string' || !userId) return invalid('userId is required');
        if (typeof reason !== 'string' || reason.trim().length < 3) return invalid('Add a short reason for this change');
        const plan = planId === undefined ? null : typeof planId === 'string' ? await getEffectivePlan(planId) : undefined;
        if (plan === undefined) return invalid('Unknown plan');
        if (classesRemaining !== undefined && classesRemaining !== null && !isCount(classesRemaining)) return invalid('Class credits must be a whole number from 0 to 999');
        if (classesRemaining === null && plan && plan.credits !== null) return invalid('Unlimited credits are only for unlimited plans');
        if (introCreditRemaining !== undefined && !isCount(introCreditRemaining)) return invalid('Demo credits must be a whole number');
        if (guestPassesRemaining !== undefined && !isCount(guestPassesRemaining)) return invalid('Guest passes must be a whole number');
        if (endDate !== undefined && (typeof endDate !== 'string' || !DATE_KEY_RE.test(endDate))) return invalid('endDate must be YYYY-MM-DD');
        if (status !== undefined && !STATUSES.includes(status as typeof STATUSES[number])) return invalid(`status must be one of ${STATUSES.join(', ')}`);

        const hasChange = [planId, classesRemaining, introCreditRemaining, guestPassesRemaining, endDate, status].some((v) => v !== undefined);
        if (!hasChange) return invalid('Nothing to change');

        const userRef = adminDb.collection('users').doc(userId);

        const result = await adminDb.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) throw { status: 404, error: 'Member not found', code: 'not-found' } satisfies HttpError;
            const current = (userDoc.data()!.subscription ?? {}) as Record<string, unknown>;

            const hasLiveRazorpayMembership = !!current.razorpaySubscriptionId
                && current.status === 'active'
                && current.autoRenew === true;
            if (plan && hasLiveRazorpayMembership) {
                throw {
                    status: 409,
                    error: 'This member has an auto-renewing Razorpay membership. Cancel it before assigning a different plan, or adjust credits and end date instead.',
                    code: 'razorpay-membership-active',
                } satisfies HttpError;
            }

            const now = new Date();
            const update: Record<string, unknown> = {};

            if (plan) {
                Object.assign(update, FRESH_PLAN_POLICY_STATE, {
                    'subscription.planId': plan.id,
                    'subscription.planCategory': plan.category,
                    'subscription.startDate': now,
                    'subscription.endDate': new Date(now.getTime() + plan.durationDays * DAY_MS),
                    'subscription.status': 'active',
                    'subscription.classesRemaining': plan.id === 'drop_in' ? 0 : plan.credits,
                    'subscription.introCreditRemaining': plan.id === 'drop_in' ? 1 : current.introCreditRemaining ?? 0,
                    'subscription.maxClassesPerDay': plan.maxClassesPerDay,
                    'subscription.weeklyClassLimit': plan.weeklyClassLimit,
                    'subscription.advanceBookingDays': plan.advanceBookingDays,
                    'subscription.guestPassesRemaining': plan.guestPasses,
                    // Granted by hand: no Razorpay subscription renews it.
                    'subscription.autoRenew': false,
                    'subscription.cancelAtPeriodEnd': false,
                    'subscription.canceledAt': null,
                    'subscription.razorpaySubscriptionId': null,
                    'subscription.razorpayPlanId': null,
                    'subscription.pendingPlanId': null,
                    'subscription.pendingRazorpayPlanId': null,
                    'subscription.pendingPlanEffectiveAt': null,
                    'subscription.grantedByAdmin': decoded.uid,
                });
            }

            if (classesRemaining !== undefined) update['subscription.classesRemaining'] = classesRemaining;
            if (introCreditRemaining !== undefined) update['subscription.introCreditRemaining'] = introCreditRemaining;
            if (guestPassesRemaining !== undefined) update['subscription.guestPassesRemaining'] = guestPassesRemaining;

            if (typeof endDate === 'string') {
                const newEnd = endOfStudioDay(endDate);
                update['subscription.endDate'] = newEnd;
                // On a Razorpay membership the next renewal recomputes endDate from
                // Razorpay's period plus accessOffsetDays, so fold the change in there
                // or it would be lost at the next charge.
                const oldEnd = toDate(current.endDate);
                if (!plan && current.razorpaySubscriptionId && oldEnd) {
                    const deltaDays = Math.round((newEnd.getTime() - oldEnd.getTime()) / DAY_MS);
                    const offset = typeof current.accessOffsetDays === 'number' ? current.accessOffsetDays : 0;
                    update['subscription.accessOffsetDays'] = Math.max(0, offset + deltaDays);
                }
                if (newEnd > now && status === undefined && !plan && current.status === 'expired' && current.planId) {
                    update['subscription.status'] = 'active';
                }
            }
            if (status !== undefined) update['subscription.status'] = status;

            const finalEnd = toDate(update['subscription.endDate'] ?? current.endDate);
            if ((update['subscription.status'] ?? current.status) === 'active' && (!finalEnd || finalEnd <= now)) {
                throw { status: 400, error: 'An active plan needs an end date in the future', code: 'invalid-argument' } satisfies HttpError;
            }
            if ((update['subscription.status'] ?? current.status) === 'active' && !(update['subscription.planId'] ?? current.planId)) {
                throw { status: 400, error: 'Assign a plan before activating this member', code: 'invalid-argument' } satisfies HttpError;
            }

            update.updatedAt = FieldValue.serverTimestamp();
            transaction.update(userRef, update);
            recordSubscriptionEvent(transaction, {
                userId,
                action: plan ? 'plan-granted' : 'plan-adjusted',
                source: 'admin',
                reason: `Admin: ${reason.trim()}`,
                actorId: decoded.uid,
                razorpaySubscriptionId: (current.razorpaySubscriptionId as string | undefined) ?? null,
                before: current,
                changes: subscriptionChanges(update),
                metadata: { route: 'admin/members/subscription' },
            });

            return subscriptionChanges(update);
        });

        return NextResponse.json({ success: true, changes: result });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
            const e = error as HttpError;
            return NextResponse.json({ error: e.error, code: e.code }, { status: e.status });
        }
        console.error('Error updating member subscription:', error);
        return NextResponse.json({ error: 'Failed to update subscription', code: 'internal' }, { status: 500 });
    }
}
