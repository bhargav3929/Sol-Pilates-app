import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { getPlanById } from '@fitconnect/shared/types/subscription';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { verifyPaymentSignature } from '@fitconnect/shared/payments/razorpay-processor';
import { FieldValue } from 'firebase-admin/firestore';
import { recordSubscriptionEvent, subscriptionChanges } from '@/lib/subscription-events';
import { FRESH_PLAN_POLICY_STATE } from '@/lib/subscriptions/billing';

function getPaymentPricingVariant(paymentData: Record<string, unknown>): 'standard' | 'founding' {
    return paymentData.metadata &&
        typeof paymentData.metadata === 'object' &&
        (paymentData.metadata as Record<string, unknown>).pricingVariant === 'founding'
        ? 'founding'
        : 'standard';
}

function isActiveUnexpiredSubscription(subscription: Record<string, unknown> | undefined | null): boolean {
    if (!subscription || subscription.status !== 'active') return false;
    if (!subscription.endDate) return true;
    const endDate = subscription.endDate && typeof subscription.endDate === 'object' && 'toDate' in subscription.endDate
        ? (subscription.endDate as { toDate: () => Date }).toDate()
        : new Date((subscription.endDate as string | number | Date | undefined) || 0);
    return endDate > new Date();
}

function isActiveMembership(subscription: Record<string, unknown> | undefined | null): boolean {
    const plan = subscription?.planId ? getPlanById(subscription.planId as string) : null;
    return isActiveUnexpiredSubscription(subscription) && (subscription?.planCategory === 'membership' || plan?.category === 'membership');
}

export async function POST(req: NextRequest) {
    // Captured as soon as known so a rejection can be written to the ledger.
    let ledger: { userId: string; paymentId: string | null; razorpayPaymentId: string | null; razorpaySubscriptionId: string | null } | null = null;
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Must be logged in', code: 'unauthenticated' }, { status: 401 });
        }
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        let body: Record<string, unknown>;
        try { body = await req.json(); }
        catch { return NextResponse.json({ error: 'Invalid request body', code: 'invalid-argument' }, { status: 400 }); }

        const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, paymentId } = body as {
            razorpay_subscription_id?: string;
            razorpay_payment_id?: string;
            razorpay_signature?: string;
            paymentId?: string;
        };

        if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature) {
            return NextResponse.json(
                { error: 'razorpay_subscription_id, razorpay_payment_id, and razorpay_signature are required', code: 'invalid-argument' },
                { status: 400 },
            );
        }

        // Razorpay signs subscription payments as HMAC(payment_id|subscription_id) — the
        // REVERSE of one-time orders (order_id|payment_id). verifyPaymentSignature builds
        // `${first}|${second}`, so razorpay_payment_id must come first here.
        const isValid = verifyPaymentSignature(
            razorpay_payment_id,
            razorpay_subscription_id,
            razorpay_signature,
            process.env.RAZORPAY_KEY_SECRET!,
        );

        if (!isValid) {
            return NextResponse.json({ error: 'Payment signature verification failed', code: 'signature-invalid' }, { status: 400 });
        }

        if (!paymentId || typeof paymentId !== 'string') {
            return NextResponse.json({ error: 'paymentId is required', code: 'invalid-argument' }, { status: 400 });
        }

        ledger = { userId, paymentId, razorpayPaymentId: razorpay_payment_id, razorpaySubscriptionId: razorpay_subscription_id };
        const paymentRef = adminDb.collection('payments').doc(paymentId);
        const userRef = adminDb.collection('users').doc(userId);

        const result = await adminDb.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            const userDoc = await transaction.get(userRef);

            if (!paymentDoc.exists) throw { status: 404, error: 'Payment not found', code: 'not-found' };
            if (!userDoc.exists) throw { status: 404, error: 'User not found', code: 'not-found' };

            const paymentData = paymentDoc.data()!;
            if (paymentData.userId !== userId) throw { status: 403, error: 'Payment does not belong to you', code: 'permission-denied' };
            if (paymentData.status !== 'pending') throw { status: 400, error: `Payment is already ${paymentData.status}`, code: 'failed-precondition' };

            const plan = await getEffectivePlan(paymentData.planId);
            if (!plan) throw { status: 400, error: 'Invalid plan on payment', code: 'failed-precondition' };

            const currentSub = userDoc.data()!.subscription as Record<string, unknown> | undefined;
            if (isActiveMembership(currentSub)) {
                throw { status: 400, error: 'You already have an active membership.', code: 'subscription-already-active' };
            }
            const currentIntroCredit = typeof currentSub?.introCreditRemaining === 'number'
                ? Math.max(0, currentSub.introCreditRemaining)
                : 0;
            const shouldCarryKickstarterCredits =
                currentSub?.planId === 'kickstarter' &&
                currentSub?.kickstarterCreditsCarriedForward !== true &&
                typeof currentSub.classesRemaining === 'number' &&
                currentSub.classesRemaining > 0;
            const carriedKickstarterCredits = shouldCarryKickstarterCredits
                ? Math.max(0, currentSub.classesRemaining as number)
                : 0;
            const membershipCredits = typeof plan.credits === 'number'
                ? plan.credits + carriedKickstarterCredits
                : plan.credits;
            const pricingVariant = getPaymentPricingVariant(paymentData);

            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + plan.durationDays);

            transaction.update(paymentRef, {
                status: 'succeeded',
                razorpayPaymentId: razorpay_payment_id,
                razorpaySubscriptionId: razorpay_subscription_id,
                paidAt: now,
            });

            const userUpdate = {
                ...FRESH_PLAN_POLICY_STATE,
                'subscription.planId': plan.id,
                'subscription.planCategory': plan.category,
                'subscription.startDate': now,
                'subscription.endDate': endDate,
                'subscription.status': 'active',
                'subscription.classesRemaining': membershipCredits,
                'subscription.introCreditRemaining': currentIntroCredit,
                'subscription.maxClassesPerDay': plan.maxClassesPerDay,
                'subscription.weeklyClassLimit': plan.weeklyClassLimit,
                'subscription.advanceBookingDays': plan.advanceBookingDays,
                'subscription.guestPassesRemaining': plan.guestPasses,
                'subscription.lastPaymentId': paymentRef.id,
                'subscription.autoRenew': plan.autoRenew,
                'subscription.razorpaySubscriptionId': razorpay_subscription_id,
                'subscription.razorpayPlanId': paymentData.metadata?.razorpayPlanId ?? null,
                'subscription.pricingVariant': pricingVariant,
                'subscription.kickstarterCreditsCarriedForward': carriedKickstarterCredits > 0,
                'subscription.carriedForwardCredits': carriedKickstarterCredits,
                'subscription.pendingPlanId': null,
                'subscription.pendingRazorpayPlanId': null,
                'subscription.pendingPlanEffectiveAt': null,
                'subscription.pendingPricingVariant': null,
                updatedAt: FieldValue.serverTimestamp(),
            };
            transaction.update(userRef, userUpdate);
            recordSubscriptionEvent(transaction, {
                userId,
                action: 'plan-granted',
                source: 'checkout-callback',
                reason: `Membership ${plan.name} (${plan.id}) started; access until ${endDate.toISOString()}`
                    + (carriedKickstarterCredits > 0 ? `, ${carriedKickstarterCredits} intro credits carried forward` : ''),
                actorId: userId,
                paymentId: paymentRef.id,
                razorpayPaymentId: razorpay_payment_id,
                razorpaySubscriptionId: razorpay_subscription_id,
                before: currentSub ?? null,
                changes: subscriptionChanges(userUpdate),
                metadata: { route: 'payments/verify-subscription', pricingVariant },
            });

            return { endDate: endDate.toISOString(), planId: plan.id, planName: plan.name, credits: membershipCredits };
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
            const e = error as { status: number; error: string; code: string };
            if (ledger) {
                await recordSubscriptionEvent(null, {
                    userId: ledger.userId,
                    action: 'grant-rejected',
                    source: 'checkout-callback',
                    reason: `${e.error} (${e.code})`,
                    actorId: ledger.userId,
                    paymentId: ledger.paymentId,
                    razorpayPaymentId: ledger.razorpayPaymentId,
                    razorpaySubscriptionId: ledger.razorpaySubscriptionId,
                    metadata: { route: 'payments/verify-subscription' },
                }).catch((err: unknown) => console.error('[verify-subscription] failed to record rejection', err));
            }
            return NextResponse.json({ error: e.error, code: e.code }, { status: e.status });
        }
        console.error('Error verifying subscription payment:', error);
        return NextResponse.json({ error: 'Failed to verify payment', code: 'internal' }, { status: 500 });
    }
}
