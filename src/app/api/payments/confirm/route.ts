import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { FieldValue } from 'firebase-admin/firestore';
import { recordSubscriptionEvent, subscriptionChanges } from '@/lib/subscription-events';
import { FRESH_PLAN_POLICY_STATE } from '@/lib/subscriptions/billing';

function isActiveUnexpiredSubscription(subscription: Record<string, unknown> | undefined | null): boolean {
    if (!subscription || subscription.status !== 'active') return false;
    if (!subscription.endDate) return true;
    const endDate = subscription.endDate && typeof subscription.endDate === 'object' && 'toDate' in subscription.endDate
        ? (subscription.endDate as { toDate: () => Date }).toDate()
        : new Date((subscription.endDate as string | number | Date | undefined) || 0);
    return endDate > new Date();
}

export async function POST(req: NextRequest) {
    // Captured as soon as known so a rejection can be written to the ledger.
    let ledger: { userId: string; paymentId: string | null } | null = null;
    try {
        // Auth
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Must be logged in', code: 'unauthenticated' },
                { status: 401 },
            );
        }
        const token = authHeader.split('Bearer ')[1];
        const decoded = await adminAuth.verifyIdToken(token);
        const userId = decoded.uid;

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: 'Invalid request body', code: 'invalid-argument' },
                { status: 400 },
            );
        }

        const paymentId = body.paymentId as string;
        if (!paymentId || typeof paymentId !== 'string') {
            return NextResponse.json(
                { error: 'paymentId is required', code: 'invalid-argument' },
                { status: 400 },
            );
        }

        ledger = { userId, paymentId };
        const paymentRef = adminDb.collection('payments').doc(paymentId);
        const userRef = adminDb.collection('users').doc(userId);

        const result = await adminDb.runTransaction(async (transaction) => {
            const paymentDoc = await transaction.get(paymentRef);
            const userDoc = await transaction.get(userRef);

            if (!paymentDoc.exists) {
                throw { status: 404, error: 'Payment not found', code: 'not-found' };
            }
            if (!userDoc.exists) {
                throw { status: 404, error: 'User not found', code: 'not-found' };
            }

            const paymentData = paymentDoc.data()!;

            // Verify payment belongs to user
            if (paymentData.userId !== userId) {
                throw { status: 403, error: 'Payment does not belong to you', code: 'permission-denied' };
            }

            // Verify payment is in confirmable state
            if (paymentData.status !== 'requires_confirmation') {
                throw { status: 400, error: `Payment is already ${paymentData.status}`, code: 'failed-precondition' };
            }

            // Look up plan
            const plan = await getEffectivePlan(paymentData.planId);
            if (!plan) {
                throw { status: 400, error: 'Invalid plan on payment', code: 'failed-precondition' };
            }

            // For membership plans, prevent overwriting an active subscription
            const currentSub = userDoc.data()!.subscription as Record<string, unknown> | undefined;
            const currentIntroCredit = typeof currentSub?.introCreditRemaining === 'number'
                ? Math.max(0, currentSub.introCreditRemaining)
                : 0;

            if (plan.category === 'membership') {
                if (isActiveUnexpiredSubscription(currentSub)) {
                    throw { status: 400, error: 'You already have an active membership. Wait for it to expire or cancel first.', code: 'subscription-already-active' };
                }
            }

            // Calculate dates
            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + plan.durationDays);

            // Update payment status
            transaction.update(paymentRef, {
                status: 'succeeded',
                paidAt: now,
            });

            // Update user subscription
            const userUpdate = {
                ...FRESH_PLAN_POLICY_STATE,
                'subscription.planId': plan.id,
                'subscription.planCategory': plan.category,
                'subscription.startDate': now,
                'subscription.endDate': endDate,
                'subscription.status': 'active',
                'subscription.classesRemaining': plan.id === 'drop_in' ? 0 : plan.credits,
                'subscription.introCreditRemaining': plan.id === 'drop_in' ? 1 : currentIntroCredit,
                'subscription.maxClassesPerDay': plan.maxClassesPerDay,
                'subscription.weeklyClassLimit': plan.weeklyClassLimit,
                'subscription.advanceBookingDays': plan.advanceBookingDays,
                'subscription.guestPassesRemaining': plan.guestPasses,
                'subscription.lastPaymentId': paymentRef.id,
                'subscription.autoRenew': plan.autoRenew,
                updatedAt: FieldValue.serverTimestamp(),
            };
            transaction.update(userRef, userUpdate);
            recordSubscriptionEvent(transaction, {
                userId,
                action: 'plan-granted',
                source: 'checkout-callback',
                reason: `Confirmed payment for ${plan.name} (${plan.id}); access until ${endDate.toISOString()}`,
                actorId: userId,
                paymentId: paymentRef.id,
                before: currentSub ?? null,
                changes: subscriptionChanges(userUpdate),
                metadata: { route: 'payments/confirm', amount: paymentData.amount ?? null },
            });

            return {
                endDate: endDate.toISOString(),
                planId: plan.id,
                planName: plan.name,
                credits: plan.credits,
            };
        });

        return NextResponse.json({
            success: true,
            endDate: result.endDate,
            planId: result.planId,
            planName: result.planName,
            credits: result.credits,
        });
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
                    metadata: { route: 'payments/confirm' },
                }).catch((err: unknown) => console.error('[confirm] failed to record rejection', err));
            }
            return NextResponse.json({ error: e.error, code: e.code }, { status: e.status });
        }
        console.error('Error confirming payment:', error);
        return NextResponse.json(
            { error: 'Failed to confirm payment', code: 'internal' },
            { status: 500 },
        );
    }
}
