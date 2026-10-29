import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { verifyWebhookSignature, type RazorpaySubscriptionEntity } from '@fitconnect/shared/payments/razorpay-processor';
import { getPlanIdForRazorpayPlanId, getPricingVariantForRazorpayPlanId } from '@/lib/razorpay/pricing';
import { findPaymentRefForOrder, grantOrderAccess } from '@/lib/payments/order-access';
import { recordSubscriptionEvent, subscriptionChanges, type SubscriptionEventInput } from '@/lib/subscription-events';
import { accessEndDate, accessOffsetDaysFor, cancelRenewalAtCycleEnd, isDeferredCancelDue } from '@/lib/subscriptions/billing';

export const dynamic = 'force-dynamic';

interface RazorpayWebhookEvent {
    id?: string;
    event: string;
    created_at?: number;
    payload: Record<string, unknown>;
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate();
    }
    if (typeof value === 'object' && 'seconds' in value) {
        return new Date((value as { seconds: number }).seconds * 1000);
    }
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
}

function fromUnixSeconds(value: unknown): Date | null {
    return typeof value === 'number' && value > 0 ? new Date(value * 1000) : null;
}

function extractSubscription(payload: Record<string, unknown>): RazorpaySubscriptionEntity | null {
    const subscription = payload.subscription as { entity?: RazorpaySubscriptionEntity } | undefined;
    return subscription?.entity ?? null;
}

function extractPayment(payload: Record<string, unknown>): Record<string, unknown> | null {
    const payment = payload.payment as { entity?: Record<string, unknown> } | undefined;
    return payment?.entity ?? null;
}

function extractOrder(payload: Record<string, unknown>): Record<string, unknown> | null {
    const order = payload.order as { entity?: Record<string, unknown> } | undefined;
    return order?.entity ?? null;
}

function getEventDocumentId(event: RazorpayWebhookEvent): string {
    const sub = extractSubscription(event.payload);
    const payment = extractPayment(event.payload);
    return event.id
        ?? `${event.event}:${sub?.id ?? payment?.id ?? 'unknown'}:${event.created_at ?? Date.now()}`;
}

/**
 * Per-request context. `notes` collects every decision the handlers make
 * (skipped, no user found, granted, ...) and is stored on the webhook event
 * document, so an event that was "processed" but changed nothing can still be
 * explained from Firestore.
 */
interface WebhookContext {
    eventId: string;
    notes: string[];
}

function note(ctx: WebhookContext, message: string) {
    ctx.notes.push(message);
    console.warn(`[webhook] ${ctx.eventId}: ${message}`);
}

async function registerWebhookEvent(event: RazorpayWebhookEvent): Promise<boolean> {
    const eventRef = adminDb.collection('razorpayWebhookEvents').doc(getEventDocumentId(event));
    const sub = extractSubscription(event.payload);
    const payment = extractPayment(event.payload);
    const order = extractOrder(event.payload);
    return adminDb.runTransaction(async (transaction) => {
        const existing = await transaction.get(eventRef);
        if (existing.exists) {
            transaction.update(eventRef, { duplicateCount: FieldValue.increment(1), lastDuplicateAt: FieldValue.serverTimestamp() });
            return false;
        }
        transaction.set(eventRef, {
            id: eventRef.id,
            event: event.event,
            razorpayEventCreatedAt: fromUnixSeconds(event.created_at),
            razorpaySubscriptionId: sub?.id ?? null,
            razorpayPaymentId: typeof payment?.id === 'string' ? payment.id : null,
            razorpayOrderId: (typeof payment?.order_id === 'string' && payment.order_id) || (typeof order?.id === 'string' && order.id) || null,
            // Raw payload kept for replay and dispute; it is Razorpay's own data.
            payload: event.payload,
            receivedAt: FieldValue.serverTimestamp(),
            processedAt: null,
            status: 'processing',
            notes: [],
            duplicateCount: 0,
        });
        return true;
    });
}

async function markWebhookEventProcessed(ctx: WebhookContext, status: 'processed' | 'failed', error?: unknown) {
    const eventRef = adminDb.collection('razorpayWebhookEvents').doc(ctx.eventId);
    await eventRef.set({
        status,
        processedAt: FieldValue.serverTimestamp(),
        notes: ctx.notes,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    }, { merge: true });
}

async function findUserRefForSubscription(subscriptionId: string): Promise<DocumentReference | null> {
    const userSnap = await adminDb
        .collection('users')
        .where('subscription.razorpaySubscriptionId', '==', subscriptionId)
        .limit(1)
        .get();

    if (!userSnap.empty) return userSnap.docs[0].ref;

    const paymentSnap = await adminDb
        .collection('payments')
        .where('razorpaySubscriptionId', '==', subscriptionId)
        .limit(1)
        .get();

    if (paymentSnap.empty) return null;
    const userId = paymentSnap.docs[0].data().userId as string | undefined;
    return userId ? adminDb.collection('users').doc(userId) : null;
}

async function markSubscriptionPayment(subscriptionId: string, status: 'succeeded' | 'failed', paymentId?: string) {
    const paymentSnap = await adminDb
        .collection('payments')
        .where('razorpaySubscriptionId', '==', subscriptionId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

    if (paymentSnap.empty) return null;
    const paymentRef = paymentSnap.docs[0].ref;
    await paymentRef.update({
        status,
        ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
        paidAt: status === 'succeeded' ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
    });
    return paymentRef.id;
}

function getAccessWindow(sub: RazorpaySubscriptionEntity, durationDays: number): { startDate: Date; endDate: Date } {
    const now = new Date();
    const startDate = fromUnixSeconds(sub.current_start) ?? fromUnixSeconds(sub.start_at) ?? now;
    const endDate = fromUnixSeconds(sub.current_end) ?? fromUnixSeconds(sub.charge_at) ?? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}

async function applySubscriptionAccess(
    ctx: WebhookContext,
    sub: RazorpaySubscriptionEntity,
    options: { resetCredits: boolean; paymentId?: string; source: string },
) {
    const userRef = await findUserRefForSubscription(sub.id);
    if (!userRef) {
        note(ctx, `${options.source}: no user found for subscriptionId=${sub.id}`);
        return;
    }

    const planId = await getPlanIdForRazorpayPlanId(sub.plan_id);
    const pricingVariant = await getPricingVariantForRazorpayPlanId(sub.plan_id);
    const plan = planId ? await getEffectivePlan(planId) : null;
    if (!plan) {
        note(ctx, `${options.source}: no app plan mapped for razorpayPlanId=${sub.plan_id}`);
        await recordSubscriptionEvent(null, {
            userId: userRef.id,
            action: 'grant-rejected',
            source: 'webhook',
            reason: `${options.source}: no app plan mapped for Razorpay plan ${sub.plan_id}`,
            razorpaySubscriptionId: sub.id,
            razorpayPaymentId: options.paymentId ?? null,
            webhookEventId: ctx.eventId,
        });
        return;
    }

    const paymentDocId = options.paymentId ? await markSubscriptionPayment(sub.id, 'succeeded', options.paymentId) : null;
    const accessWindow = getAccessWindow(sub, plan.durationDays);

    // A member who cancelled with less than the required notice owed this
    // charge; now that it has landed, stop renewal at the end of this cycle.
    const preGrantSub = (await userRef.get()).data()?.subscription as Record<string, unknown> | undefined;
    const deferredCancelApplied = options.resetCredits
        && isDeferredCancelDue(preGrantSub, sub.id, accessWindow.startDate)
        && await cancelRenewalAtCycleEnd(sub.id);

    await adminDb.runTransaction(async (transaction) => {
        const freshUserDoc = await transaction.get(userRef);
        if (!freshUserDoc.exists) {
            note(ctx, `${options.source}: user ${userRef.id} disappeared before grant`);
            return;
        }

        const currentSub = freshUserDoc.data()?.subscription as Record<string, unknown> | undefined;
        const currentIntroCredit = typeof currentSub?.introCreditRemaining === 'number'
            ? Math.max(0, currentSub.introCreditRemaining)
            : 0;
        const existingClassesRemaining = currentSub?.classesRemaining as number | null | undefined;
        const existingGuestPasses = currentSub?.guestPassesRemaining as number | undefined;
        const offsetDays = accessOffsetDaysFor(currentSub, sub.id);
        const endDate = accessEndDate(accessWindow.endDate, currentSub, sub.id);
        const renewalCanceled = (
            currentSub?.cancelAtPeriodEnd === true ||
            sub.cancel_at_cycle_end === true ||
            deferredCancelApplied
        ) && endDate > new Date();
        const shouldCarryKickstarterCredits =
            options.source === 'subscription.activated' &&
            currentSub?.planId === 'kickstarter' &&
            currentSub?.kickstarterCreditsCarriedForward !== true &&
            typeof currentSub.classesRemaining === 'number' &&
            currentSub.classesRemaining > 0;
        const carriedKickstarterCredits = shouldCarryKickstarterCredits
            ? Math.max(0, currentSub.classesRemaining as number)
            : 0;
        const activationCredits = typeof plan.credits === 'number'
            ? plan.credits + carriedKickstarterCredits
            : plan.credits;
        const nextClassesRemaining = options.resetCredits
            ? plan.credits
            : existingClassesRemaining ?? activationCredits;

        const userUpdate = {
            'subscription.planId': plan.id,
            'subscription.planCategory': plan.category,
            'subscription.startDate': accessWindow.startDate,
            'subscription.endDate': endDate,
            'subscription.accessOffsetDays': offsetDays,
            'subscription.status': 'active',
            'subscription.classesRemaining': nextClassesRemaining,
            'subscription.introCreditRemaining': currentIntroCredit,
            'subscription.maxClassesPerDay': plan.maxClassesPerDay,
            'subscription.weeklyClassLimit': plan.weeklyClassLimit,
            'subscription.advanceBookingDays': plan.advanceBookingDays,
            'subscription.guestPassesRemaining': options.resetCredits ? plan.guestPasses : existingGuestPasses ?? plan.guestPasses,
            'subscription.lastPaymentId': paymentDocId ?? currentSub?.lastPaymentId ?? null,
            'subscription.autoRenew': !renewalCanceled,
            'subscription.cancelAtPeriodEnd': renewalCanceled,
            'subscription.canceledAt': deferredCancelApplied ? FieldValue.serverTimestamp() : null,
            ...(deferredCancelApplied || currentSub?.razorpaySubscriptionId !== sub.id
                ? { 'subscription.cancelAfterNextCharge': false } : {}),
            'subscription.razorpaySubscriptionId': sub.id,
            'subscription.razorpayPlanId': sub.plan_id,
            'subscription.pricingVariant': pricingVariant ?? currentSub?.pricingVariant ?? 'standard',
            'subscription.kickstarterCreditsCarriedForward': currentSub?.kickstarterCreditsCarriedForward === true || carriedKickstarterCredits > 0,
            'subscription.carriedForwardCredits': carriedKickstarterCredits > 0 ? carriedKickstarterCredits : currentSub?.carriedForwardCredits ?? 0,
            'subscription.pendingPlanId': sub.has_scheduled_changes ? currentSub?.pendingPlanId ?? null : null,
            'subscription.pendingRazorpayPlanId': sub.has_scheduled_changes ? currentSub?.pendingRazorpayPlanId ?? null : null,
            'subscription.pendingPlanEffectiveAt': sub.has_scheduled_changes
                ? fromUnixSeconds(sub.change_scheduled_at) ?? currentSub?.pendingPlanEffectiveAt ?? null
                : null,
            'subscription.pendingPricingVariant': sub.has_scheduled_changes ? currentSub?.pendingPricingVariant ?? null : null,
            'subscription.lastSyncedAt': FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
        transaction.update(userRef, userUpdate);

        const action = options.source === 'subscription.activated'
            ? 'plan-granted'
            : options.resetCredits ? 'plan-renewed' : 'plan-changed';
        recordSubscriptionEvent(transaction, {
            userId: userRef.id,
            action,
            source: 'webhook',
            reason: `${options.source}: ${plan.name} (${plan.id}) active until ${endDate.toISOString()}`
                + (offsetDays > 0 ? ` (includes ${offsetDays} frozen day(s))` : '')
                + (deferredCancelApplied ? ', final cycle: renewal stopped per late cancellation notice' : '')
                + (options.resetCredits ? ', credits reset' : ', credits kept')
                + (carriedKickstarterCredits > 0 ? `, ${carriedKickstarterCredits} intro credits carried forward` : ''),
            paymentId: paymentDocId,
            razorpayPaymentId: options.paymentId ?? null,
            razorpaySubscriptionId: sub.id,
            webhookEventId: ctx.eventId,
            before: currentSub ?? null,
            changes: subscriptionChanges(userUpdate),
            metadata: { razorpayStatus: sub.status ?? null, razorpayPlanId: sub.plan_id },
        });
        ctx.notes.push(`${options.source}: ${action} for user ${userRef.id}`);
    });
}

export async function POST(req: NextRequest) {
    const signature = req.headers.get('x-razorpay-signature');
    if (!signature) {
        return NextResponse.json({ error: 'Missing signature header', code: 'unauthorized' }, { status: 400 });
    }

    const rawBody = await req.text();
    const isValid = verifyWebhookSignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET!);
    if (!isValid) {
        return NextResponse.json({ error: 'Webhook signature verification failed', code: 'signature-invalid' }, { status: 400 });
    }

    const event = JSON.parse(rawBody) as RazorpayWebhookEvent;
    const shouldProcess = await registerWebhookEvent(event);
    if (!shouldProcess) return NextResponse.json({ received: true, duplicate: true });

    const ctx: WebhookContext = { eventId: getEventDocumentId(event), notes: [] };

    try {
        switch (event.event) {
            case 'subscription.activated':
                await handleSubscriptionActivated(ctx, event.payload);
                break;
            case 'subscription.charged':
            case 'invoice.paid':
                await handleSubscriptionCharged(ctx, event.payload);
                break;
            case 'subscription.updated':
                await handleSubscriptionUpdated(ctx, event.payload);
                break;
            case 'subscription.halted':
                await handleSubscriptionHalted(ctx, event.payload);
                break;
            case 'subscription.cancelled':
                await handleSubscriptionCancelled(ctx, event.payload);
                break;
            case 'subscription.completed':
                await handleSubscriptionCompleted(ctx, event.payload);
                break;
            case 'order.paid':
            case 'payment.captured':
                await handleOrderPaid(ctx, event.payload, event.event);
                break;
            case 'payment.failed':
                await handlePaymentFailed(ctx, event.payload);
                break;
            default:
                ctx.notes.push(`ignored: no handler for ${event.event}`);
                break;
        }
        await markWebhookEventProcessed(ctx, 'processed');
    } catch (error) {
        console.error(`[webhook] Error handling ${event.event}:`, error);
        await markWebhookEventProcessed(ctx, 'failed', error);
    }

    return NextResponse.json({ received: true });
}

async function handleSubscriptionActivated(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.activated: payload has no subscription entity'); return; }
    await applySubscriptionAccess(ctx, sub, { resetCredits: false, source: 'subscription.activated' });
}

async function handleSubscriptionCharged(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.charged: payload has no subscription entity'); return; }
    const payment = extractPayment(payload);
    await applySubscriptionAccess(ctx, sub, {
        resetCredits: true,
        paymentId: typeof payment?.id === 'string' ? payment.id : undefined,
        source: 'subscription.charged',
    });
}

/**
 * Applies a small subscription update in a transaction and writes the matching
 * ledger row with the before snapshot, for the status-only webhook handlers.
 */
async function updateSubscriptionWithEvent(
    ctx: WebhookContext,
    userRef: DocumentReference,
    buildUpdate: (current: Record<string, unknown> | undefined) => Record<string, unknown>,
    event: Omit<SubscriptionEventInput, 'userId' | 'source' | 'before' | 'changes' | 'webhookEventId'>,
) {
    await adminDb.runTransaction(async (transaction) => {
        const doc = await transaction.get(userRef);
        if (!doc.exists) {
            note(ctx, `${event.reason}: user ${userRef.id} not found`);
            return;
        }
        const current = doc.data()?.subscription as Record<string, unknown> | undefined;
        const update = buildUpdate(current);
        transaction.update(userRef, update);
        recordSubscriptionEvent(transaction, {
            ...event,
            userId: userRef.id,
            source: 'webhook',
            webhookEventId: ctx.eventId,
            before: current ?? null,
            changes: subscriptionChanges(update),
        });
        ctx.notes.push(`${event.action} for user ${userRef.id}`);
    });
}

async function handleSubscriptionUpdated(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.updated: payload has no subscription entity'); return; }

    if (sub.has_scheduled_changes) {
        const userRef = await findUserRefForSubscription(sub.id);
        if (!userRef) { note(ctx, `subscription.updated: no user found for subscriptionId=${sub.id}`); return; }
        const pendingPlanId = await getPlanIdForRazorpayPlanId(sub.plan_id);
        const pendingPricingVariant = await getPricingVariantForRazorpayPlanId(sub.plan_id);
        const effectiveAt = fromUnixSeconds(sub.change_scheduled_at);

        await updateSubscriptionWithEvent(ctx, userRef, () => ({
            'subscription.pendingPlanId': pendingPlanId,
            'subscription.pendingRazorpayPlanId': sub.plan_id,
            'subscription.pendingPlanEffectiveAt': effectiveAt,
            'subscription.pendingPricingVariant': pendingPricingVariant,
            'subscription.lastSyncedAt': FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }), {
            action: 'plan-change-scheduled',
            reason: `subscription.updated: change to ${pendingPlanId ?? sub.plan_id} scheduled for ${effectiveAt?.toISOString() ?? 'next cycle'}`,
            razorpaySubscriptionId: sub.id,
        });
        return;
    }

    // A mid-cycle plan update should preserve the app-calculated credit balance.
    // Renewals are handled by subscription.charged / invoice.paid, which resets credits.
    await applySubscriptionAccess(ctx, sub, { resetCredits: false, source: 'subscription.updated' });
}

async function handleSubscriptionHalted(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.halted: payload has no subscription entity'); return; }

    const userRef = await findUserRefForSubscription(sub.id);
    if (!userRef) { note(ctx, `subscription.halted: no user found for subscriptionId=${sub.id}`); return; }

    await updateSubscriptionWithEvent(ctx, userRef, () => ({
        'subscription.status': 'halted',
        'subscription.autoRenew': false,
        'subscription.lastSyncedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }), {
        action: 'plan-halted',
        reason: 'subscription.halted: Razorpay halted the subscription after repeated failed charges',
        razorpaySubscriptionId: sub.id,
    });
}

async function handleSubscriptionCancelled(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.cancelled: payload has no subscription entity'); return; }

    const userRef = await findUserRefForSubscription(sub.id);
    if (!userRef) { note(ctx, `subscription.cancelled: no user found for subscriptionId=${sub.id}`); return; }

    await updateSubscriptionWithEvent(ctx, userRef, (subscription) => {
        const endDate = toDate(subscription?.endDate) ?? fromUnixSeconds(sub.current_end) ?? fromUnixSeconds(sub.ended_at);
        const isStillUsable = !!endDate && endDate > new Date();
        return {
            'subscription.status': isStillUsable ? 'active' : 'canceled',
            'subscription.autoRenew': false,
            'subscription.cancelAtPeriodEnd': isStillUsable,
            'subscription.canceledAt': subscription?.canceledAt ?? FieldValue.serverTimestamp(),
            'subscription.lastSyncedAt': FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };
    }, {
        action: 'plan-canceled',
        reason: 'subscription.cancelled: renewal stopped; access continues until the paid period ends',
        razorpaySubscriptionId: sub.id,
    });
}

async function handleSubscriptionCompleted(ctx: WebhookContext, payload: Record<string, unknown>) {
    const sub = extractSubscription(payload);
    if (!sub) { note(ctx, 'subscription.completed: payload has no subscription entity'); return; }

    const userRef = await findUserRefForSubscription(sub.id);
    if (!userRef) { note(ctx, `subscription.completed: no user found for subscriptionId=${sub.id}`); return; }

    await updateSubscriptionWithEvent(ctx, userRef, () => ({
        'subscription.autoRenew': false,
        'subscription.lastSyncedAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    }), {
        action: 'plan-canceled',
        reason: 'subscription.completed: all billing cycles finished, auto-renew turned off',
        razorpaySubscriptionId: sub.id,
    });
}

/**
 * Safety net for one-time Orders (drop_in, kickstarter). The checkout callback
 * normally grants access, but it never fires if the tab closes or the network
 * drops between capture and redirect - which strands a captured payment with no
 * plan. This grants from the webhook instead; grantOrderAccess is idempotent, so
 * whichever path lands first wins.
 *
 * Subscription payments carry a subscription_id and are handled by
 * subscription.charged / invoice.paid, so they are skipped here.
 */
async function handleOrderPaid(ctx: WebhookContext, payload: Record<string, unknown>, source: string) {
    const payment = extractPayment(payload);
    const order = extractOrder(payload);

    if (payment && typeof payment.subscription_id === 'string' && payment.subscription_id) {
        ctx.notes.push(`${source}: skipped, belongs to subscription ${payment.subscription_id}`);
        return;
    }
    if (payment && payment.status !== 'captured') {
        ctx.notes.push(`${source}: skipped, payment status is ${String(payment.status)}`);
        return;
    }

    const orderId = (typeof payment?.order_id === 'string' && payment.order_id)
        || (typeof order?.id === 'string' && order.id)
        || null;
    const razorpayPaymentId = typeof payment?.id === 'string' ? payment.id : null;

    if (!orderId || !razorpayPaymentId) {
        note(ctx, `${source}: missing order id or payment id`);
        return;
    }

    const paymentRef = await findPaymentRefForOrder(orderId);
    if (!paymentRef) {
        note(ctx, `${source}: no payment doc for orderId=${orderId} (order not created by this app?)`);
        return;
    }

    const result = await grantOrderAccess({
        paymentRef,
        razorpayPaymentId,
        razorpayOrderId: orderId,
        identity: {
            email: typeof payment?.email === 'string' ? payment.email : undefined,
            phone: typeof payment?.contact === 'string' ? payment.contact : undefined,
        },
        source,
        webhookEventId: ctx.eventId,
    });

    ctx.notes.push(`${source}: grant result ${result.status}${result.status === 'conflict' ? ` (${result.code}: ${result.message})` : ''}`);

    if (result.status === 'conflict') {
        console.error(`[webhook] ${source}: could not grant access for orderId=${orderId}: ${result.code} ${result.message}`);
        await paymentRef.set({
            needsReview: true,
            reviewReason: `${result.code}: ${result.message}`,
            razorpayPaymentId,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}

async function handlePaymentFailed(ctx: WebhookContext, payload: Record<string, unknown>) {
    const payment = extractPayment(payload);
    if (!payment) { note(ctx, 'payment.failed: payload has no payment entity'); return; }

    const subscriptionId = typeof payment.subscription_id === 'string'
        ? payment.subscription_id
        : typeof payment.invoice_id === 'string'
            ? payment.invoice_id
            : null;

    await adminDb.collection('paymentFailures').add({
        razorpayPaymentId: payment.id ?? null,
        orderId: payment.order_id ?? null,
        subscriptionId,
        errorDescription: payment.error_description ?? payment.description ?? null,
        recordedAt: FieldValue.serverTimestamp(),
    });

    const failureReason = String(payment.error_description ?? payment.description ?? 'unknown');
    ctx.notes.push(`payment.failed: ${failureReason}`);

    if (subscriptionId) {
        const paymentDocId = await markSubscriptionPayment(subscriptionId, 'failed', typeof payment.id === 'string' ? payment.id : undefined);
        const userRef = await findUserRefForSubscription(subscriptionId);
        if (userRef) {
            await recordSubscriptionEvent(null, {
                userId: userRef.id,
                action: 'grant-rejected',
                source: 'webhook',
                reason: `payment.failed: Razorpay reported "${failureReason}"; no plan change made`,
                paymentId: paymentDocId,
                razorpayPaymentId: typeof payment.id === 'string' ? payment.id : null,
                razorpaySubscriptionId: subscriptionId,
                webhookEventId: ctx.eventId,
            });
        }
    }
}
