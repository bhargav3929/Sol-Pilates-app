import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { VALID_PLAN_IDS } from '@fitconnect/shared/types/subscription';
import { getEffectivePlan } from '@/lib/plans/catalog';
import { processPayment } from '@fitconnect/shared/payments/mock-processor';
import { getChargeAmount, getSyncedPlanEntry } from '@/lib/razorpay/pricing';

export async function POST(req: NextRequest) {
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

        // Read user doc — needed for both membership check and founding member pricing
        const userDoc = await adminDb.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data()! : null;

        // For membership plans, check if user already has an active membership
        if (plan.category === 'membership' && userData) {
            const sub = userData.subscription;
            if (sub?.status === 'active' && sub?.planCategory === 'membership') {
                const endDate = sub.endDate?.toDate?.() || new Date(sub.endDate);
                if (endDate > new Date()) {
                    return NextResponse.json(
                        { error: 'You already have an active membership. Wait for it to expire or cancel first.', code: 'already-exists' },
                        { status: 409 },
                    );
                }
            }
        }

        const syncedPlan = await getSyncedPlanEntry(planId);

        // Use synced Razorpay base price, then apply founding member discount if eligible.
        const isFoundingMember = userData?.isFoundingMember === true;
        const chargeAmount = getChargeAmount(plan, syncedPlan, isFoundingMember);

        // Process mock payment
        const result = await processPayment(chargeAmount);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error || 'Payment failed', code: 'payment-failed' },
                { status: 402 },
            );
        }

        // Create payment document
        const paymentRef = adminDb.collection('payments').doc();
        const now = new Date();

        const paymentDoc = {
            id: paymentRef.id,
            paymentIntentId: result.paymentIntentId,
            userId,
            amount: chargeAmount,
            currency: 'usd',
            status: 'requires_confirmation',
            planId,
            metadata: {
                planName: plan.name,
                planCategory: plan.category,
                credits: plan.credits,
                durationDays: plan.durationDays,
                listPrice: syncedPlan?.price ?? plan.price,
                pricingSource: syncedPlan?.source ?? 'static',
                razorpayPlanId: syncedPlan?.razorpayPlanId ?? null,
                razorpayItemId: syncedPlan?.razorpayItemId ?? null,
                foundingMemberDiscountApplied: isFoundingMember && !!plan.foundingPrice,
            },
            createdAt: now,
            paidAt: null,
        };

        await paymentRef.set(paymentDoc);

        return NextResponse.json({
            paymentId: paymentRef.id,
            clientSecret: result.paymentIntentId,
            amount: chargeAmount,
            status: 'requires_confirmation',
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        return NextResponse.json(
            { error: 'Failed to create payment', code: 'internal' },
            { status: 500 },
        );
    }
}
