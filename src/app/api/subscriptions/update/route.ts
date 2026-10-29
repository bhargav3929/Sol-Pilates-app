import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { recordSubscriptionEvent, subscriptionChanges } from '@/lib/subscription-events';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { getPlanById, VALID_PLAN_IDS, type PlanId } from '@fitconnect/shared/types/subscription';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { updateRazorpaySubscription } from '@fitconnect/shared/payments/razorpay-processor';
import { getChargeAmount, getSyncedPlanEntry } from '@/lib/razorpay/pricing';
import { accessEndDate } from '@/lib/subscriptions/billing';

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

function getAccessWindow(
    subscription: { current_start?: number | null; current_end?: number | null; start_at?: number | null },
    fallbackDurationDays: number,
): { startDate: Date; endDate: Date } {
    const now = new Date();
    const startDate = fromUnixSeconds(subscription.current_start) ?? fromUnixSeconds(subscription.start_at) ?? now;
    const endDate = fromUnixSeconds(subscription.current_end) ?? new Date(now.getTime() + fallbackDurationDays * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}

function getImmediateChangeCredits(
    currentRemaining: unknown,
    currentPlanCredits: number | null | undefined,
    targetPlanCredits: number | null,
): number | null {
    if (targetPlanCredits === null) return null;

    const safeCurrentRemaining = typeof currentRemaining === 'number'
        ? Math.max(0, currentRemaining)
        : Math.max(0, currentPlanCredits ?? 0);
    const addedCredits = Math.max(0, targetPlanCredits - (currentPlanCredits ?? 0));
    return safeCurrentRemaining + addedCredits;
}

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Must be logged in', code: 'unauthenticated' }, { status: 401 });
        }

        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid request body', code: 'invalid-argument' }, { status: 400 });
        }

        const planId = body.planId as string;
        if (!planId || !VALID_PLAN_IDS.includes(planId as PlanId)) {
            return NextResponse.json(
                { error: `Invalid planId. Must be one of: ${VALID_PLAN_IDS.join(', ')}`, code: 'invalid-argument' },
                { status: 400 },
            );
        }

        const targetPlan = (await getEffectivePlan(planId))!;
        if (targetPlan.category !== 'membership') {
            return NextResponse.json(
                { error: 'Only membership subscriptions can be updated.', code: 'invalid-argument' },
                { status: 400 },
            );
        }

        const userRef = adminDb.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return NextResponse.json({ error: 'User not found', code: 'not-found' }, { status: 404 });
        }

        const userData = userDoc.data();
        const currentSub = userData?.subscription as Record<string, unknown> | undefined;
        const currentPlan = currentSub?.planId ? getPlanById(currentSub.planId as string) : null;
        if (!currentSub || currentSub.status !== 'active' || (currentSub.planCategory !== 'membership' && currentPlan?.category !== 'membership')) {
            return NextResponse.json(
                { error: 'No active Razorpay membership to update.', code: 'failed-precondition' },
                { status: 400 },
            );
        }
        if (currentSub.cancelAtPeriodEnd === true) {
            return NextResponse.json(
                {
                    error: 'Renewal is already canceled. Choose a new membership after the current paid period ends.',
                    code: 'renewal-canceled',
                },
                { status: 409 },
            );
        }

        const currentPlanId = currentSub.planId as string | undefined;
        if (currentPlanId === targetPlan.id) {
            return NextResponse.json(
                { error: 'You are already on this plan.', code: 'already-exists' },
                { status: 409 },
            );
        }

        const razorpaySubscriptionId = currentSub.razorpaySubscriptionId as string | undefined;
        if (!razorpaySubscriptionId) {
            return NextResponse.json(
                { error: 'This membership is not linked to a Razorpay subscription yet.', code: 'not-configured' },
                { status: 409 },
            );
        }

        const isFoundingMember = userData?.isFoundingMember === true;
        const foundingDiscountEligible = isFoundingMember && !!targetPlan.foundingPrice;
        const syncedTargetPlan = await getSyncedPlanEntry(targetPlan.id);
        const standardRazorpayPlanId = syncedTargetPlan?.razorpayPlanId ?? targetPlan.razorpayPlanId;
        const foundingRazorpayPlanId = syncedTargetPlan?.foundingRazorpayPlanId ?? null;
        const razorpayPlanId = foundingDiscountEligible ? foundingRazorpayPlanId : standardRazorpayPlanId;
        if (!razorpayPlanId) {
            return NextResponse.json(
                {
                    error: foundingDiscountEligible
                        ? `Founding member plan '${targetPlan.id}' is not configured in Razorpay yet.`
                        : `Plan '${targetPlan.id}' is not configured as a Razorpay subscription plan.`,
                    code: foundingDiscountEligible ? 'founding-plan-not-configured' : 'plan-not-configured',
                },
                { status: 503 },
            );
        }

        const currentPlanForPricing = currentPlanId ? await getEffectivePlan(currentPlanId) : null;
        const syncedCurrentPlan = currentPlanForPricing ? await getSyncedPlanEntry(currentPlanForPricing.id) : null;
        const currentFoundingDiscountEligible = isFoundingMember && !!currentPlanForPricing?.foundingPrice;
        const currentPrice = currentPlanForPricing
            ? getChargeAmount(currentPlanForPricing, syncedCurrentPlan, currentFoundingDiscountEligible)
            : 0;
        const targetPrice = getChargeAmount(targetPlan, syncedTargetPlan, foundingDiscountEligible);
        const scheduleChangeAt: 'now' | 'cycle_end' = targetPrice >= currentPrice ? 'now' : 'cycle_end';

        const rzpSub = await updateRazorpaySubscription(
            razorpaySubscriptionId,
            razorpayPlanId,
            process.env.RAZORPAY_KEY_ID!,
            process.env.RAZORPAY_KEY_SECRET!,
            {
                remainingCount: targetPlan.razorpayTotalCount ?? 24,
                scheduleChangeAt,
                customerNotify: true,
            },
        );

        const now = new Date();
        const currentIntroCredit = typeof currentSub.introCreditRemaining === 'number'
            ? Math.max(0, currentSub.introCreditRemaining)
            : 0;
        const accessWindow = getAccessWindow(rzpSub, targetPlan.durationDays);
        const effectiveAt = scheduleChangeAt === 'cycle_end'
            // Razorpay's cycle end, not the local end date, which may include frozen days.
            ? fromUnixSeconds(rzpSub.change_scheduled_at) ?? fromUnixSeconds(rzpSub.current_end) ?? toDate(currentSub.endDate) ?? accessWindow.endDate
            : accessWindow.startDate;
        const immediateClassesRemaining = getImmediateChangeCredits(
            currentSub.classesRemaining,
            currentPlanForPricing?.credits,
            targetPlan.credits,
        );

        const changeRef = adminDb.collection('subscriptionChanges').doc();
        const batch = adminDb.batch();

        batch.set(changeRef, {
            id: changeRef.id,
            userId,
            razorpaySubscriptionId,
            fromPlanId: currentPlanId ?? null,
            toPlanId: targetPlan.id,
            razorpayPlanId,
            standardRazorpayPlanId: standardRazorpayPlanId ?? null,
            foundingRazorpayPlanId,
            foundingMemberDiscountApplied: foundingDiscountEligible,
            pricingVariant: foundingDiscountEligible ? 'founding' : 'standard',
            scheduleChangeAt,
            status: rzpSub.has_scheduled_changes ? 'scheduled' : 'applied',
            requestedAt: now,
            effectiveAt,
            razorpayStatus: rzpSub.status,
            previousClassesRemaining: typeof currentSub.classesRemaining === 'number' ? currentSub.classesRemaining : null,
            nextClassesRemaining: scheduleChangeAt === 'cycle_end' || rzpSub.has_scheduled_changes
                ? null
                : immediateClassesRemaining,
            source: 'member_update',
        });

        if (scheduleChangeAt === 'cycle_end' || rzpSub.has_scheduled_changes) {
            const userUpdate = {
                'subscription.pendingPlanId': targetPlan.id,
                'subscription.pendingRazorpayPlanId': razorpayPlanId,
                'subscription.pendingPlanEffectiveAt': effectiveAt,
                'subscription.pendingPricingVariant': foundingDiscountEligible ? 'founding' : 'standard',
                'subscription.cancelAtPeriodEnd': false,
                updatedAt: FieldValue.serverTimestamp(),
            };
            batch.update(userRef, userUpdate);
            recordSubscriptionEvent(batch, {
                userId,
                action: 'plan-change-scheduled',
                source: 'member',
                reason: `Member scheduled change from ${currentPlanId ?? 'none'} to ${targetPlan.id}, effective ${effectiveAt?.toISOString() ?? 'next cycle'}`,
                actorId: userId,
                razorpaySubscriptionId,
                before: currentSub,
                changes: subscriptionChanges(userUpdate),
                metadata: { route: 'subscriptions/update', subscriptionChangeId: changeRef.id },
            });
        } else {
            const userUpdate = {
                'subscription.planId': targetPlan.id,
                'subscription.planCategory': targetPlan.category,
                'subscription.startDate': accessWindow.startDate,
                'subscription.endDate': accessEndDate(accessWindow.endDate, currentSub, razorpaySubscriptionId),
                'subscription.status': 'active',
                'subscription.classesRemaining': immediateClassesRemaining,
                'subscription.introCreditRemaining': currentIntroCredit,
                'subscription.maxClassesPerDay': targetPlan.maxClassesPerDay,
                'subscription.weeklyClassLimit': targetPlan.weeklyClassLimit,
                'subscription.advanceBookingDays': targetPlan.advanceBookingDays,
                'subscription.guestPassesRemaining': targetPlan.guestPasses,
                'subscription.autoRenew': targetPlan.autoRenew,
                'subscription.cancelAtPeriodEnd': false,
                'subscription.razorpaySubscriptionId': razorpaySubscriptionId,
                'subscription.razorpayPlanId': razorpayPlanId,
                'subscription.pricingVariant': foundingDiscountEligible ? 'founding' : 'standard',
                'subscription.pendingPlanId': null,
                'subscription.pendingRazorpayPlanId': null,
                'subscription.pendingPlanEffectiveAt': null,
                'subscription.pendingPricingVariant': null,
                updatedAt: FieldValue.serverTimestamp(),
            };
            batch.update(userRef, userUpdate);
            recordSubscriptionEvent(batch, {
                userId,
                action: 'plan-changed',
                source: 'member',
                reason: `Member changed plan from ${currentPlanId ?? 'none'} to ${targetPlan.id} immediately; credits ${String(currentSub.classesRemaining)} -> ${String(immediateClassesRemaining)}`,
                actorId: userId,
                razorpaySubscriptionId,
                before: currentSub,
                changes: subscriptionChanges(userUpdate),
                metadata: { route: 'subscriptions/update', subscriptionChangeId: changeRef.id },
            });
        }

        await batch.commit();

        return NextResponse.json({
            success: true,
            mode: scheduleChangeAt === 'cycle_end' || rzpSub.has_scheduled_changes ? 'scheduled' : 'immediate',
            planId: targetPlan.id,
            planName: targetPlan.name,
            effectiveAt: effectiveAt?.toISOString() ?? null,
            endDate: accessWindow.endDate.toISOString(),
            status: rzpSub.status,
        });
    } catch (error) {
        console.error('[subscriptions/update] Failed to update subscription:', error);
        const message = error instanceof Error ? error.message : 'Failed to update subscription';
        return NextResponse.json({ error: message, code: 'internal' }, { status: 500 });
    }
}
