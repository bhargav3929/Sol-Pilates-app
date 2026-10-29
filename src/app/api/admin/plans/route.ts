import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { adminAuth } from '@/lib/firebase/admin';
import {
    PLAN_CATALOG,
    PLAN_OVERRIDE_LIMITS,
    VALID_PLAN_IDS,
    applyPlanOverride,
    applyPlanOverrides,
    type PlanDefinition,
    type PlanId,
    type PlanOverride,
} from '@fitconnect/shared/types/subscription';
import { applyGstToRupees, GST_RATE_BPS } from '@fitconnect/shared/utils/gst';
import { createRazorpayPlan } from '@fitconnect/shared/payments/razorpay-processor';
import {
    getPlanCatalogHistory,
    getPlanOverrides,
    savePlanOverride,
} from '@/lib/plans/catalog';
import { getSyncedPricing, syncRazorpayPricing, type SyncedPlanEntry } from '@/lib/razorpay/pricing';

// ---------------------------------------------------------------------------
// /api/admin/plans — edit packages and pricing (admin only)
//
// GET    → every plan with its defaults, current override and Razorpay status
// PUT    → save an override for one plan (creates Razorpay plans on membership
//          price changes so new sign-ups are billed the new amount)
// DELETE → reset one plan to its compiled-in defaults
// ---------------------------------------------------------------------------

type AdminCheck =
    | { ok: true; uid: string; email: string | null }
    | { ok: false; error: string; code: string; status: number };

function errorResponse(error: string, code: string, status: number) {
    return NextResponse.json({ error, code }, { status });
}

async function verifyAdmin(req: NextRequest): Promise<AdminCheck> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return { ok: false, error: 'Must be logged in', code: 'unauthenticated', status: 401 };
    }
    try {
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        if (!decoded.admin) {
            return { ok: false, error: 'Admin access required', code: 'permission-denied', status: 403 };
        }
        return { ok: true, uid: decoded.uid, email: decoded.email ?? null };
    } catch {
        return { ok: false, error: 'Invalid or expired session', code: 'unauthenticated', status: 401 };
    }
}

const L = PLAN_OVERRIDE_LIMITS;
const overrideSchema = z.object({
    name: z.string().trim().min(L.name.min).max(L.name.max).optional(),
    price: z.number().int().min(L.price.min).max(L.price.max).optional(),
    foundingPrice: z.number().int().min(L.price.min).max(L.price.max).nullable().optional(),
    credits: z.number().int().min(L.credits.min).max(L.credits.max).nullable().optional(),
    durationDays: z.number().int().min(L.durationDays.min).max(L.durationDays.max).optional(),
    weeklyClassLimit: z.number().int().min(L.weeklyClassLimit.min).max(L.weeklyClassLimit.max).optional(),
    guestPasses: z.number().int().min(L.guestPasses.min).max(L.guestPasses.max).optional(),
    tagline: z.string().trim().max(L.tagline.max).optional(),
    features: z.array(z.string().trim().min(1).max(L.features.maxLength)).max(L.features.maxItems).optional(),
    recommended: z.boolean().optional(),
    hidden: z.boolean().optional(),
}).strict();

const putSchema = z.object({
    planId: z.enum(VALID_PLAN_IDS as [PlanId, ...PlanId[]]),
    override: overrideSchema,
}).strict();

function razorpayMode(): 'live' | 'test' | 'unconfigured' {
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) return 'unconfigured';
    return keyId.startsWith('rzp_test') ? 'test' : 'live';
}

/**
 * Drops override fields that equal the default so the stored override stays
 * sparse, and returns null when nothing differs.
 */
function minimizeOverride(defaults: PlanDefinition, override: PlanOverride): PlanOverride | null {
    const out: PlanOverride = {};
    if (override.name !== undefined && override.name !== defaults.name) out.name = override.name;
    if (override.price !== undefined && override.price !== defaults.price) out.price = override.price;
    if (override.foundingPrice !== undefined) {
        const def = defaults.foundingPrice ?? null;
        if (override.foundingPrice !== def) out.foundingPrice = override.foundingPrice;
    }
    if (override.credits !== undefined && override.credits !== defaults.credits) out.credits = override.credits;
    if (override.durationDays !== undefined && override.durationDays !== defaults.durationDays) out.durationDays = override.durationDays;
    if (override.weeklyClassLimit !== undefined && override.weeklyClassLimit !== defaults.weeklyClassLimit) out.weeklyClassLimit = override.weeklyClassLimit;
    if (override.guestPasses !== undefined && override.guestPasses !== defaults.guestPasses) out.guestPasses = override.guestPasses;
    if (override.tagline !== undefined && override.tagline !== (defaults.tagline ?? '')) out.tagline = override.tagline;
    if (override.features !== undefined && JSON.stringify(override.features) !== JSON.stringify(defaults.features)) out.features = override.features;
    if (override.recommended !== undefined && override.recommended !== !!defaults.recommended) out.recommended = override.recommended;
    if (override.hidden !== undefined && override.hidden !== !!defaults.hidden) out.hidden = override.hidden;
    return Object.keys(out).length ? out : null;
}

function diffPlans(before: PlanDefinition, after: PlanDefinition): Record<string, { from: unknown; to: unknown }> {
    const fields: Array<keyof PlanDefinition> = [
        'name', 'price', 'foundingPrice', 'credits', 'durationDays', 'weeklyClassLimit',
        'guestPasses', 'tagline', 'features', 'recommended', 'hidden',
    ];
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of fields) {
        const a = before[field] ?? null;
        const b = after[field] ?? null;
        if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { from: a, to: b };
    }
    return changes;
}

function razorpayStatus(plan: PlanDefinition, entry: SyncedPlanEntry | undefined, lastSyncedAt: string | null) {
    if (plan.category !== 'membership') return null;
    const expected = applyGstToRupees(plan.price).totalPaise;
    const amountPaise = entry?.amountPaise ?? null;
    const foundingExpected = plan.foundingPrice ? applyGstToRupees(plan.foundingPrice).totalPaise : null;
    const foundingAmountPaise = entry?.foundingAmountPaise ?? null;
    const standardInSync = amountPaise !== null && amountPaise === expected;
    const foundingInSync = foundingExpected === null || foundingAmountPaise === foundingExpected;
    return {
        razorpayPlanId: entry?.razorpayPlanId ?? null,
        foundingRazorpayPlanId: entry?.foundingRazorpayPlanId ?? null,
        amountPaise,
        foundingAmountPaise,
        inSync: standardInSync && foundingInSync,
        lastSyncedAt,
    };
}

async function buildResponse() {
    const [overrides, pricing, history] = await Promise.all([
        getPlanOverrides(),
        getSyncedPricing(),
        getPlanCatalogHistory(25),
    ]);
    const catalog = applyPlanOverrides(overrides);
    const plans = catalog.map((plan, i) => ({
        plan,
        defaults: PLAN_CATALOG[i],
        override: overrides[plan.id] ?? null,
        razorpay: razorpayStatus(plan, pricing.plans.find((p) => p.planId === plan.id), pricing.lastSyncedAt),
    }));
    return { plans, history, razorpayMode: razorpayMode() };
}

/**
 * Membership billing lives in Razorpay plans with immutable amounts. When the
 * effective price (standard or founding) changes, mint a new plan for each
 * changed variant. Sync then prefers the newest plan per variant.
 */
async function ensureRazorpayPlans(before: PlanDefinition, after: PlanDefinition): Promise<Record<string, string>> {
    if (after.category !== 'membership') return {};
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error('Razorpay keys are not configured on this server, so membership prices cannot be changed here.');
    }
    if (!after.razorpayPeriod || !after.razorpayInterval) {
        throw new Error(`Plan '${after.id}' has no Razorpay billing period configured.`);
    }

    const created: Record<string, string> = {};
    const variants: Array<{ variant: 'standard' | 'founding'; rupees: number }> = [];
    if (after.price !== before.price || after.name !== before.name) {
        variants.push({ variant: 'standard', rupees: after.price });
    }
    if (after.foundingPrice && (after.foundingPrice !== before.foundingPrice || after.name !== before.name)) {
        variants.push({ variant: 'founding', rupees: after.foundingPrice });
    }

    for (const { variant, rupees } of variants) {
        if (rupees <= 0) continue;
        const gst = applyGstToRupees(rupees);
        const plan = await createRazorpayPlan(
            {
                planId: after.id,
                variant,
                name: after.name,
                basePaise: gst.basePaise,
                totalPaise: gst.totalPaise,
                gstBps: GST_RATE_BPS,
                period: after.razorpayPeriod,
                interval: after.razorpayInterval,
            },
            keyId,
            keySecret,
        );
        created[variant] = plan.id;
    }
    return created;
}

async function refreshPricing(catalog: PlanDefinition[]) {
    try {
        await syncRazorpayPricing(catalog);
    } catch (error) {
        console.error('[admin/plans] pricing re-sync failed', error);
    }
    // The public pricing route is ISR-cached; drop it so customers see the edit now.
    try {
        revalidatePath('/api/subscriptions/pricing');
    } catch {
        // Not fatal: the cache expires on its own within five minutes.
    }
}

export async function GET(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);
        return NextResponse.json(await buildResponse());
    } catch (error) {
        console.error('[admin/plans] GET failed', error);
        return errorResponse('Failed to load plans', 'internal', 500);
    }
}

export async function PUT(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return errorResponse('Invalid request body', 'invalid-argument', 400);
        }
        const parsed = putSchema.safeParse(body);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
            return errorResponse(`${path}${issue?.message ?? 'Invalid input'}`, 'invalid-argument', 400);
        }
        const { planId, override } = parsed.data;

        const defaults = PLAN_CATALOG.find((p) => p.id === planId)!;
        const overrides = await getPlanOverrides();
        const before = applyPlanOverride(defaults, overrides[planId]);

        // The client sends the full editable state, so the new override replaces the old one.
        const minimized = minimizeOverride(defaults, override);
        const after = applyPlanOverride(defaults, minimized ?? undefined);

        if (after.foundingPrice !== undefined && after.foundingPrice >= after.price) {
            return errorResponse('Founding price must be lower than the standard price', 'invalid-argument', 400);
        }
        if (after.category === 'membership' && after.price <= 0) {
            return errorResponse('Membership price must be greater than zero', 'invalid-argument', 400);
        }

        const changes = diffPlans(before, after);
        if (!Object.keys(changes).length) {
            return NextResponse.json({ success: true, unchanged: true, plan: (await buildResponse()).plans.find((p) => p.plan.id === planId) });
        }

        // Create Razorpay plans before persisting, so a Razorpay failure never
        // leaves the catalog advertising a price nobody can be billed at.
        const razorpayPlanIds = await ensureRazorpayPlans(before, after);

        await savePlanOverride({
            planId,
            override: minimized,
            changes,
            razorpayPlanIds,
            adminUid: auth.uid,
            adminEmail: auth.email,
        });

        const nextOverrides = { ...overrides };
        if (minimized) nextOverrides[planId] = minimized; else delete nextOverrides[planId];
        await refreshPricing(applyPlanOverrides(nextOverrides));

        const response = await buildResponse();
        return NextResponse.json({
            success: true,
            plan: response.plans.find((p) => p.plan.id === planId),
            razorpayPlanIds,
        });
    } catch (error) {
        console.error('[admin/plans] PUT failed', error);
        const message = error instanceof Error ? error.message : 'Failed to update plan';
        return errorResponse(message, 'internal', 500);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);

        const planId = req.nextUrl.searchParams.get('planId') ?? '';
        if (!VALID_PLAN_IDS.includes(planId as PlanId)) {
            return errorResponse('Unknown planId', 'invalid-argument', 400);
        }
        const typedPlanId = planId as PlanId;

        const defaults = PLAN_CATALOG.find((p) => p.id === typedPlanId)!;
        const overrides = await getPlanOverrides();
        if (!overrides[typedPlanId]) {
            return NextResponse.json({ success: true, unchanged: true, plan: (await buildResponse()).plans.find((p) => p.plan.id === typedPlanId) });
        }
        const before = applyPlanOverride(defaults, overrides[typedPlanId]);
        const changes = diffPlans(before, defaults);

        const razorpayPlanIds = await ensureRazorpayPlans(before, defaults);

        await savePlanOverride({
            planId: typedPlanId,
            override: null,
            changes,
            razorpayPlanIds,
            adminUid: auth.uid,
            adminEmail: auth.email,
        });

        const nextOverrides = { ...overrides };
        delete nextOverrides[typedPlanId];
        await refreshPricing(applyPlanOverrides(nextOverrides));

        const response = await buildResponse();
        return NextResponse.json({
            success: true,
            plan: response.plans.find((p) => p.plan.id === typedPlanId),
            razorpayPlanIds,
        });
    } catch (error) {
        console.error('[admin/plans] DELETE failed', error);
        const message = error instanceof Error ? error.message : 'Failed to reset plan';
        return errorResponse(message, 'internal', 500);
    }
}
