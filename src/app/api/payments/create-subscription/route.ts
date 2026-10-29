import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { getPlanById, VALID_PLAN_IDS } from '@fitconnect/shared/types/subscription';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { createRazorpaySubscription } from '@fitconnect/shared/payments/razorpay-processor';
import { getChargeBreakdown, getSyncedPlanEntry } from '@/lib/razorpay/pricing';
import { GST_RATE_PERCENT } from '@fitconnect/shared/utils/gst';

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

        const planId = body.planId as string;
        if (!planId || !VALID_PLAN_IDS.includes(planId as typeof VALID_PLAN_IDS[number])) {
            return NextResponse.json(
                { error: `Invalid planId. Must be one of: ${VALID_PLAN_IDS.join(', ')}`, code: 'invalid-argument' },
                { status: 400 },
            );
        }

        const plan = (await getEffectivePlan(planId))!;
        if (plan.hidden) {
            return NextResponse.json({ error: 'This plan is not available right now.', code: 'plan-unavailable' }, { status: 400 });
        }

        if (plan.category !== 'membership') {
            return NextResponse.json(
                { error: 'Subscriptions are only available for membership plans. Use create-order for class packs.', code: 'invalid-argument' },
                { status: 400 },
            );
        }

        const syncedPlan = await getSyncedPlanEntry(planId);
        const razorpayPlanId = syncedPlan?.razorpayPlanId ?? plan.razorpayPlanId;

        if (!razorpayPlanId) {
            return NextResponse.json(
                {
                    error: `Plan '${planId}' is not yet configured for subscriptions. Visit /api/subscriptions/pricing to sync plans from Razorpay.`,
                    code: 'plan-not-configured',
                },
                { status: 503 },
            );
        }

        const userDoc = await adminDb.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data()! : null;

        if (isActiveMembership(userData?.subscription)) {
            return NextResponse.json(
                {
                    error: 'You already have an active membership. Use the upgrade flow to change your plan.',
                    code: 'active-membership-update-required',
                },
                { status: 409 },
            );
        }

        const isFoundingMember = userData?.isFoundingMember === true;
        const foundingDiscountEligible = isFoundingMember && !!plan.foundingPrice;

        if (foundingDiscountEligible && !syncedPlan?.foundingRazorpayPlanId) {
            return NextResponse.json(
                {
                    error: `Founding member plan '${planId}' is not configured in Razorpay yet.`,
                    code: 'founding-plan-not-configured',
                },
                { status: 503 },
            );
        }

        // The Razorpay plan is charged as-is; once GST plans exist that amount is
        // GST-inclusive, so the split comes from the plan rather than our arithmetic.
        const gst = getChargeBreakdown(plan, syncedPlan, isFoundingMember);
        const chargeAmount = gst.basePaise / 100;
        const subscriptionRazorpayPlanId = foundingDiscountEligible
            ? syncedPlan!.foundingRazorpayPlanId!
            : razorpayPlanId;
        const keyId = process.env.RAZORPAY_KEY_ID!;
        const keySecret = process.env.RAZORPAY_KEY_SECRET!;

        const rzpSub = await createRazorpaySubscription(
            subscriptionRazorpayPlanId,
            plan.razorpayTotalCount ?? 24,
            keyId,
            keySecret,
            {
                planId,
                userId,
                pricingVariant: foundingDiscountEligible ? 'founding' : 'standard',
            },
        );

        const paymentRef = adminDb.collection('payments').doc();
        await paymentRef.set({
            id: paymentRef.id,
            razorpaySubscriptionId: rzpSub.id,
            userId,
            amount: chargeAmount,
            basePaise: gst.basePaise,
            gstPaise: gst.gstPaise,
            totalPaise: gst.totalPaise,
            gstRatePercent: GST_RATE_PERCENT,
            currency: 'INR',
            status: 'pending',
            planId,
            kind: 'subscription_create',
            metadata: {
                planName: plan.name,
                planCategory: plan.category,
                credits: plan.credits,
                durationDays: plan.durationDays,
                listPrice: syncedPlan?.price ?? plan.price,
                chargeAmount,
                pricingSource: syncedPlan?.source ?? 'static',
                razorpayPlanId: subscriptionRazorpayPlanId,
                standardRazorpayPlanId: razorpayPlanId,
                foundingRazorpayPlanId: syncedPlan?.foundingRazorpayPlanId ?? null,
                razorpayItemId: syncedPlan?.razorpayItemId ?? null,
                foundingMemberDiscountApplied: foundingDiscountEligible,
                pricingVariant: foundingDiscountEligible ? 'founding' : 'standard',
            },
            createdAt: new Date(),
            paidAt: null,
        });

        return NextResponse.json({
            subscriptionId: rzpSub.id,
            paymentId: paymentRef.id,
            amount: gst.totalPaise,
            currency: 'INR',
            key: keyId,
            status: rzpSub.status,
            basePaise: gst.basePaise,
            gstPaise: gst.gstPaise,
            totalPaise: gst.totalPaise,
            gstRatePercent: GST_RATE_PERCENT,
        });
    } catch (error) {
        console.error('Error creating Razorpay subscription:', error);
        return NextResponse.json({ error: 'Failed to create subscription', code: 'internal' }, { status: 500 });
    }
}
