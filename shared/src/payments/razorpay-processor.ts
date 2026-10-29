import * as crypto from 'crypto';
import Razorpay from 'razorpay';

export interface RazorpayOrder {
    id: string;
    amount: number;
    currency: string;
}

export interface RazorpayVerifyPayload {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
}

export type RazorpaySubscriptionStatus =
    | 'created'
    | 'authenticated'
    | 'active'
    | 'pending'
    | 'halted'
    | 'cancelled'
    | 'completed'
    | 'expired';

export interface RazorpaySubscriptionEntity {
    id: string;
    status: RazorpaySubscriptionStatus;
    plan_id: string;
    short_url?: string;
    current_start?: number | null;
    current_end?: number | null;
    charge_at?: number | null;
    start_at?: number | null;
    ended_at?: number | null;
    cancel_at_cycle_end?: boolean;
    total_count?: number;
    paid_count?: number;
    remaining_count?: number;
    has_scheduled_changes?: boolean;
    change_scheduled_at?: number | null;
    schedule_change_at?: 'now' | 'cycle_end';
    notes?: Record<string, string>;
}

/**
 * Verifies Razorpay payment signature.
 * Razorpay signs: HMAC_SHA256(orderId + "|" + paymentId, keySecret)
 */
export function verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string,
    keySecret: string,
): boolean {
    const expected = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    try {
        const expectedBuf = Buffer.from(expected, 'hex');
        const sigBuf = Buffer.from(signature, 'hex');
        return expectedBuf.length === sigBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch {
        return false;
    }
}

/**
 * Verifies a Razorpay webhook signature.
 * Razorpay signs the raw request body: HMAC_SHA256(rawBody, webhookSecret)
 */
export function verifyWebhookSignature(
    rawBody: string,
    signature: string,
    webhookSecret: string,
): boolean {
    const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
    try {
        const expectedBuf = Buffer.from(expected, 'hex');
        const sigBuf = Buffer.from(signature, 'hex');
        return expectedBuf.length === sigBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch {
        return false;
    }
}

/**
 * Creates a Razorpay subscription for a recurring membership plan.
 */
export async function createRazorpaySubscription(
    razorpayPlanId: string,
    totalCount: number,
    keyId: string,
    keySecret: string,
    notes?: Record<string, string>,
): Promise<RazorpaySubscriptionEntity> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const sub = await client.subscriptions.create({
        plan_id: razorpayPlanId,
        total_count: totalCount,
        customer_notify: 1,
        ...(notes ? { notes } : {}),
    }) as unknown as RazorpaySubscriptionEntity;
    return sub;
}

/**
 * Updates an active/authenticated Razorpay subscription to a new plan.
 * schedule_change_at='now' charges/refunds prorated differences immediately.
 * schedule_change_at='cycle_end' applies the new plan after the current cycle.
 */
export async function updateRazorpaySubscription(
    subscriptionId: string,
    razorpayPlanId: string,
    keyId: string,
    keySecret: string,
    options: {
        remainingCount?: number;
        scheduleChangeAt?: 'now' | 'cycle_end';
        customerNotify?: boolean;
    } = {},
): Promise<RazorpaySubscriptionEntity> {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1/subscriptions/${subscriptionId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            plan_id: razorpayPlanId,
            remaining_count: options.remainingCount ?? 24,
            schedule_change_at: options.scheduleChangeAt ?? 'now',
            customer_notify: options.customerNotify ?? true,
        }),
    });

    const data = await response.json() as RazorpaySubscriptionEntity & { error?: { description?: string; reason?: string } };
    if (!response.ok) {
        throw new Error(data.error?.description || data.error?.reason || 'Failed to update Razorpay subscription');
    }
    return data;
}

/**
 * Cancels a Razorpay subscription. Defaults to cancel at end of current billing cycle.
 * Pass cancelAtCycleEnd=false to cancel immediately.
 */
export async function cancelRazorpaySubscription(
    subscriptionId: string,
    keyId: string,
    keySecret: string,
    cancelAtCycleEnd = true,
): Promise<{ id: string; status: string }> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const result = await (client.subscriptions as unknown as {
        cancel: (id: string, opts: { cancel_at_cycle_end: number }) => Promise<{ id: string; status: string }>;
    }).cancel(subscriptionId, { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 });
    return { id: result.id, status: result.status };
}

/**
 * Fetches a Razorpay subscription. Returns the subscription object including short_url.
 */
export async function fetchRazorpaySubscription(
    subscriptionId: string,
    keyId: string,
    keySecret: string,
): Promise<RazorpaySubscriptionEntity> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const result = await (client.subscriptions as unknown as {
        fetch: (id: string) => Promise<RazorpaySubscriptionEntity>;
    }).fetch(subscriptionId);
    return result;
}

export interface CreateRazorpayPlanInput {
    /** Our PlanId, recorded in notes so pricing sync can match it. */
    planId: string;
    variant: 'standard' | 'founding';
    /** Customer-facing name shown on the Razorpay plan. */
    name: string;
    /** GST-exclusive base in paise, recorded in notes. */
    basePaise: number;
    /** Amount actually charged per cycle, in paise (base + GST). */
    totalPaise: number;
    gstBps: number;
    period: 'monthly';
    interval: number;
}

/**
 * Creates a Razorpay Plan. Plan amounts are immutable, so a price change means
 * a new plan; pricing sync picks the newest plan per planId/variant.
 */
export async function createRazorpayPlan(
    input: CreateRazorpayPlanInput,
    keyId: string,
    keySecret: string,
): Promise<{ id: string; amount: number }> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const plan = await (client.plans as unknown as {
        create: (params: Record<string, unknown>) => Promise<{ id: string; item: { amount: number } }>;
    }).create({
        period: input.period,
        interval: input.interval,
        item: {
            name: `${input.name}${input.variant === 'founding' ? ' (Founding)' : ''} - incl. GST`,
            amount: input.totalPaise,
            currency: 'INR',
        },
        notes: {
            fitconnect_plan_id: input.planId,
            fitconnect_variant: input.variant,
            fitconnect_gst_bps: String(input.gstBps),
            fitconnect_base_paise: String(input.basePaise),
            fitconnect_created_by: 'admin-panel',
        },
    });
    return { id: plan.id, amount: plan.item.amount };
}

/**
 * Lists all Razorpay plans. Returns plans with their item amounts (in paise) and notes.
 * Use notes.fitconnect_plan_id to match against our PlanId values.
 */
export async function listRazorpayPlans(
    keyId: string,
    keySecret: string,
): Promise<Array<{
    id: string;
    amount: number;        // in paise
    currency: string;
    name: string;
    period: string;
    interval: number;
    createdAt?: number;
    fitconnectPlanId?: string;
    fitconnectVariant?: string;
    /** GST-exclusive base recorded on GST plans, in paise. Absent on pre-GST plans. */
    fitconnectBasePaise?: number;
}>> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const result = await (client.plans as unknown as {
        all: (opts?: Record<string, unknown>) => Promise<{ items: Array<{
            id: string;
            created_at?: number;
            interval: number;
            period: string;
            item: { amount: number; currency: string; name: string };
            notes?: Record<string, string>;
        }>; count: number }>
    }).all({ count: 100 });

    return result.items.map((plan) => ({
        id: plan.id,
        amount: plan.item.amount,
        currency: plan.item.currency,
        name: plan.item.name,
        period: plan.period,
        interval: plan.interval,
        createdAt: plan.created_at,
        fitconnectPlanId: plan.notes?.fitconnect_plan_id,
        fitconnectVariant: plan.notes?.fitconnect_variant,
        fitconnectBasePaise: plan.notes?.fitconnect_base_paise
            ? Number(plan.notes.fitconnect_base_paise)
            : undefined,
    }));
}

/**
 * Lists all active Razorpay Items. Items are used as a pricing catalog when the
 * Subscriptions product is not yet enabled on the account.
 * Match to our plan catalog via description field containing "fitconnect_plan_id:<planId>".
 */
export async function listRazorpayItems(
    keyId: string,
    keySecret: string,
): Promise<Array<{
    id: string;
    name: string;
    description: string;
    amount: number;    // in paise
    currency: string;
    fitconnectPlanId?: string;
}>> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const result = await (client.items as unknown as {
        all: (opts?: Record<string, unknown>) => Promise<{ items: Array<{
            id: string;
            name: string;
            description?: string;
            amount: number;
            currency: string;
            active: boolean;
        }>; count: number }>
    }).all({ count: 100 });

    return result.items
        .filter(item => item.active)
        .map(item => {
            const match = item.description?.match(/fitconnect_plan_id:(\S+)/);
            return {
                id: item.id,
                name: item.name,
                description: item.description ?? '',
                amount: item.amount,
                currency: item.currency,
                fitconnectPlanId: match?.[1],
            };
        });
}

/**
 * Creates a Razorpay order. The amount is in PAISE, not rupees: GST-inclusive
 * totals do not always land on a whole rupee, so the caller does the arithmetic
 * in paise and passes the exact figure through.
 */
export async function createRazorpayOrder(
    amountPaise: number,
    planId: string,
    keyId: string,
    keySecret: string,
): Promise<RazorpayOrder> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await client.orders.create({
        amount: Math.round(amountPaise),
        currency: 'INR',
        receipt: planId,
    });
    return {
        id: order.id,
        amount: order.amount as number,
        currency: order.currency,
    };
}

export interface RazorpayOrderEntity {
    id: string;
    amount: number;        // in paise
    amount_paid: number;   // in paise
    currency: string;
    receipt?: string;
    status: 'created' | 'attempted' | 'paid';
    created_at?: number;
}

export interface RazorpayPaymentEntity {
    id: string;
    order_id?: string;
    amount: number;        // in paise
    currency: string;
    status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
    email?: string;
    contact?: string;
    created_at?: number;
}

/**
 * Fetches a Razorpay order. Throws if the order does not exist on this account,
 * which is the only reliable way to tell "unknown order" from "no payments yet":
 * the /orders/{id}/payments endpoint answers 200 with an empty list for both.
 */
export async function fetchRazorpayOrder(
    orderId: string,
    keyId: string,
    keySecret: string,
): Promise<RazorpayOrderEntity> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    return (client.orders as unknown as {
        fetch: (id: string) => Promise<RazorpayOrderEntity>;
    }).fetch(orderId);
}

/**
 * Lists the payment attempts made against a Razorpay order.
 */
export async function listRazorpayOrderPayments(
    orderId: string,
    keyId: string,
    keySecret: string,
): Promise<RazorpayPaymentEntity[]> {
    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const result = await (client.orders as unknown as {
        fetchPayments: (id: string) => Promise<{ items: RazorpayPaymentEntity[] }>;
    }).fetchPayments(orderId);
    return result.items ?? [];
}
