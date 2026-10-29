import { adminDb } from '@/lib/firebase/admin';
import { PLAN_CATALOG, type PlanDefinition, type PlanId } from '@fitconnect/shared/types/subscription';
import { getEffectiveCatalog } from '@/lib/plans/catalog';
import { listRazorpayItems, listRazorpayPlans } from '@fitconnect/shared/payments/razorpay-processor';
import { applyGstToRupees, type GstBreakdown } from '@fitconnect/shared/utils/gst';

export type PricingSource = 'plans' | 'items' | 'static';
export type PricingVariant = 'standard' | 'founding';

export interface SyncedPlanEntry {
    planId: string;
    name: string;
    /**
     * For memberships this is the amount the Razorpay plan charges, which is
     * GST-INCLUSIVE once GST plans exist. For class packs it is the GST-exclusive
     * base, because our own code adds GST when creating the order. Use
     * getChargeBreakdown rather than reading this directly for money decisions.
     */
    price: number;
    foundingPrice: number | null;
    razorpayPlanId: string | null;
    foundingRazorpayPlanId: string | null;
    razorpayItemId: string | null;
    configured: boolean;
    foundingConfigured: boolean;
    category: string;
    source: PricingSource;
    /** Charged amount in paise, straight from the Razorpay plan (memberships). */
    amountPaise?: number | null;
    foundingAmountPaise?: number | null;
    /** GST-exclusive base in paise, from the plan's notes. Absent on pre-GST plans. */
    basePaise?: number | null;
    foundingBasePaise?: number | null;
    /**
     * What a customer actually pays, split for display. Derived by
     * getChargeBreakdown so the pricing page can never disagree with checkout.
     */
    charge?: GstBreakdown;
    foundingCharge?: GstBreakdown | null;
}

export interface SyncedPricing {
    plans: SyncedPlanEntry[];
    lastSyncedAt: string | null;
    source: PricingSource;
    /** Effective plan catalog (defaults + admin overrides). Attached on read. */
    catalog?: PlanDefinition[];
}

const PRICING_CACHE_MS = 5 * 60 * 1000;

/**
 * The synced pricing cache lives in Firestore, and dev, preview and production
 * all share one Firestore project. Razorpay plan IDs are per-account, so a doc
 * written by a test-key environment is meaningless (and harmful) to a live-key
 * one - it hands out plan IDs that do not exist on the live account.
 *
 * Two guards keep them apart:
 *   1. Test and live keys write to different documents.
 *   2. Every document records the key that produced it; a read from a different
 *      key is treated as a cache miss and re-synced.
 */
function pricingCacheDocId(keyId: string | undefined): string {
    return keyId?.startsWith('rzp_test') ? 'razorpayPlans-test' : 'razorpayPlans';
}

function buildFallbackPlans(catalog: PlanDefinition[] = PLAN_CATALOG): SyncedPlanEntry[] {
    return catalog.map((plan) => ({
        planId: plan.id,
        name: plan.name,
        price: plan.price,
        foundingPrice: plan.foundingPrice ?? null,
        razorpayPlanId: null,
        foundingRazorpayPlanId: null,
        razorpayItemId: null,
        configured: false,
        foundingConfigured: false,
        category: plan.category,
        source: 'static',
    }));
}

function getSyncSource(plans: SyncedPlanEntry[]): PricingSource {
    if (plans.some((plan) => plan.source === 'plans')) return 'plans';
    if (plans.some((plan) => plan.source === 'items')) return 'items';
    return 'static';
}

function toMillis(value: unknown): number | null {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') {
        const time = new Date(value).getTime();
        return Number.isNaN(time) ? null : time;
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate().getTime();
    }
    return null;
}

function normalizeStoredPricing(data: Record<string, unknown> | undefined): SyncedPricing | null {
    const plans = data?.plans;
    if (!Array.isArray(plans)) return null;

    return {
        plans: plans as SyncedPlanEntry[],
        lastSyncedAt: typeof data?.lastSyncedAt === 'string' ? data.lastSyncedAt : null,
        source: (data?.source as PricingSource | undefined) ?? getSyncSource(plans as SyncedPlanEntry[]),
    };
}

export async function syncRazorpayPricing(catalogInput?: PlanDefinition[]): Promise<SyncedPricing> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const catalog = catalogInput ?? await getEffectiveCatalog();

    if (!keyId || !keySecret) {
        return { plans: buildFallbackPlans(catalog), lastSyncedAt: null, source: 'static' };
    }

    type RazorpayPlanMatch = { razorpayPlanId: string; amountPaise: number; basePaise: number | null; createdAt: number };
    const planMap = new Map<string, RazorpayPlanMatch[]>();
    const foundingPlanMap = new Map<string, RazorpayPlanMatch[]>();
    const itemMap = new Map<string, { itemId: string; amountPaise: number }>();

    try {
        const razorpayPlans = await listRazorpayPlans(keyId, keySecret);
        for (const plan of razorpayPlans) {
            if (!plan.fitconnectPlanId) continue;
            const targetMap = plan.fitconnectVariant?.toLowerCase() === 'founding'
                ? foundingPlanMap
                : planMap;
            const matches = targetMap.get(plan.fitconnectPlanId) ?? [];
            matches.push({
                razorpayPlanId: plan.id,
                amountPaise: plan.amount,
                basePaise: typeof plan.fitconnectBasePaise === 'number' ? plan.fitconnectBasePaise : null,
                createdAt: plan.createdAt ?? 0,
            });
            targetMap.set(plan.fitconnectPlanId, matches);
        }
    } catch (error) {
        console.warn('[pricing] Razorpay Plans sync failed:', error);
    }

    try {
        const razorpayItems = await listRazorpayItems(keyId, keySecret);
        for (const item of razorpayItems) {
            if (item.fitconnectPlanId) {
                itemMap.set(item.fitconnectPlanId, {
                    itemId: item.id,
                    amountPaise: item.amount,
                });
            }
        }
    } catch (error) {
        console.warn('[pricing] Razorpay Items sync failed:', error);
    }

    const selectStandardPlan = (matches: RazorpayPlanMatch[] | undefined): RazorpayPlanMatch | undefined => {
        if (!matches?.length) return undefined;
        return [...matches].sort((a, b) => b.createdAt - a.createdAt)[0];
    };

    const selectFoundingPlan = (
        matches: RazorpayPlanMatch[] | undefined,
        plan: PlanDefinition,
    ): RazorpayPlanMatch | undefined => {
        if (!matches?.length || !plan.foundingPrice) return undefined;
        // A founding plan may be priced at the bare founding price (pre-GST plans)
        // or at that price plus GST (plans created by create-razorpay-gst-plans).
        const expectedBase = plan.foundingPrice * 100;
        const expectedWithGst = applyGstToRupees(plan.foundingPrice).totalPaise;
        const sortedMatches = [...matches].sort((a, b) => b.createdAt - a.createdAt);
        return sortedMatches.find((match) => match.amountPaise === expectedWithGst)
            ?? sortedMatches.find((match) => match.amountPaise === expectedBase)
            ?? sortedMatches[0];
    };

    const plans: SyncedPlanEntry[] = catalog.map((plan) => {
        const planMatch = selectStandardPlan(planMap.get(plan.id));
        const foundingPlanMatch = selectFoundingPlan(foundingPlanMap.get(plan.id), plan);
        const itemMatch = itemMap.get(plan.id);

        if (plan.category === 'membership' && planMatch) {
            return {
                planId: plan.id,
                name: plan.name,
                price: Math.round(planMatch.amountPaise / 100),
                foundingPrice: foundingPlanMatch ? Math.round(foundingPlanMatch.amountPaise / 100) : plan.foundingPrice ?? null,
                razorpayPlanId: planMatch.razorpayPlanId,
                foundingRazorpayPlanId: foundingPlanMatch?.razorpayPlanId ?? null,
                razorpayItemId: itemMatch?.itemId ?? null,
                configured: true,
                foundingConfigured: !!foundingPlanMatch,
                category: plan.category,
                source: 'plans',
                amountPaise: planMatch.amountPaise,
                foundingAmountPaise: foundingPlanMatch?.amountPaise ?? null,
                basePaise: planMatch.basePaise,
                foundingBasePaise: foundingPlanMatch?.basePaise ?? null,
            };
        }

        if (itemMatch) {
            return {
                planId: plan.id,
                name: plan.name,
                price: Math.round(itemMatch.amountPaise / 100),
                foundingPrice: plan.foundingPrice ?? null,
                razorpayPlanId: planMatch?.razorpayPlanId ?? null,
                foundingRazorpayPlanId: foundingPlanMatch?.razorpayPlanId ?? null,
                razorpayItemId: itemMatch.itemId,
                configured: true,
                foundingConfigured: !!foundingPlanMatch,
                category: plan.category,
                source: 'items',
            };
        }

        return {
            planId: plan.id,
            name: plan.name,
            price: plan.price,
            foundingPrice: foundingPlanMatch ? Math.round(foundingPlanMatch.amountPaise / 100) : plan.foundingPrice ?? null,
            razorpayPlanId: plan.razorpayPlanId ?? null,
            foundingRazorpayPlanId: foundingPlanMatch?.razorpayPlanId ?? null,
            razorpayItemId: null,
            configured: false,
            foundingConfigured: !!foundingPlanMatch,
            category: plan.category,
            source: 'static',
        };
    });

    const lastSyncedAt = new Date().toISOString();
    const source = getSyncSource(plans);
    const planIdMap: Record<string, string> = {};
    const foundingPlanIdMap: Record<string, string> = {};
    const itemIdMap: Record<string, string> = {};

    for (const plan of plans) {
        if (plan.razorpayPlanId) planIdMap[plan.planId] = plan.razorpayPlanId;
        if (plan.foundingRazorpayPlanId) foundingPlanIdMap[plan.planId] = plan.foundingRazorpayPlanId;
        if (plan.razorpayItemId) itemIdMap[plan.planId] = plan.razorpayItemId;
    }

    await adminDb.collection('settings').doc(pricingCacheDocId(keyId)).set({
        planIdMap,
        foundingPlanIdMap,
        itemIdMap,
        plans,
        lastSyncedAt,
        source,
        keyId,
    });

    return { plans, lastSyncedAt, source };
}

/**
 * Applies the effective catalog to a pricing snapshot and attaches the
 * customer-facing charge breakdown, so every surface (pricing page, plan
 * selector, mobile) renders the same numbers checkout uses.
 *
 * Admin overrides win for names and for class-pack prices, because our own code
 * sets pack order amounts. Membership prices stay as the Razorpay plan charges
 * them: a membership price edit creates a new Razorpay plan and re-syncs, so
 * the synced amount is the truth about what a new member will pay.
 */
function applyCatalog(pricing: SyncedPricing, catalog: PlanDefinition[]): SyncedPricing {
    return {
        ...pricing,
        catalog,
        plans: pricing.plans.map((stored) => {
            const plan = catalog.find((p) => p.id === stored.planId);
            if (!plan) return stored;
            const entry: SyncedPlanEntry = { ...stored, name: plan.name, category: plan.category };
            if (plan.category === 'class_pack') {
                entry.price = plan.price;
                entry.foundingPrice = plan.foundingPrice ?? null;
            } else if (!entry.foundingRazorpayPlanId) {
                entry.foundingPrice = plan.foundingPrice ?? null;
            }
            return {
                ...entry,
                charge: getChargeBreakdown(plan, entry, false),
                foundingCharge: plan.foundingPrice ? getChargeBreakdown(plan, entry, true) : null,
            };
        }),
    };
}

export async function getSyncedPricing(): Promise<SyncedPricing> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const catalog = await getEffectiveCatalog();

    try {
        const settingsDoc = await adminDb.collection('settings').doc(pricingCacheDocId(keyId)).get();
        const data = settingsDoc.exists ? settingsDoc.data() : undefined;
        const stored = normalizeStoredPricing(data);
        const lastSyncedAt = toMillis(data?.lastSyncedAt);
        const storedKeyId = typeof data?.keyId === 'string' ? data.keyId : null;

        // A doc with no `keyId` predates this guard, so its provenance is unknown -
        // re-sync rather than trust it.
        if (stored && storedKeyId !== keyId) {
            console.warn(
                `[pricing] Cached pricing was synced with ${storedKeyId ?? 'an unrecorded key'} but ` +
                `this environment uses ${keyId ?? 'no key'}; ignoring the cache and re-syncing.`,
            );
        } else if (stored && lastSyncedAt && Date.now() - lastSyncedAt < PRICING_CACHE_MS) {
            return applyCatalog(stored, catalog);
        }
    } catch (error) {
        console.warn('[pricing] Failed to read stored Razorpay pricing:', error);
    }

    try {
        return applyCatalog(await syncRazorpayPricing(catalog), catalog);
    } catch (error) {
        console.error('[pricing] Failed to sync Razorpay pricing:', error);
        return applyCatalog({ plans: buildFallbackPlans(catalog), lastSyncedAt: null, source: 'static' }, catalog);
    }
}

export async function getSyncedPlanEntry(planId: string): Promise<SyncedPlanEntry | null> {
    const pricing = await getSyncedPricing();
    return pricing.plans.find((plan) => plan.planId === planId) ?? null;
}

export async function getPlanIdForRazorpayPlanId(razorpayPlanId: string): Promise<PlanId | null> {
    const pricing = await getSyncedPricing();
    const syncedMatch = pricing.plans.find(
        (plan) => plan.razorpayPlanId === razorpayPlanId || plan.foundingRazorpayPlanId === razorpayPlanId,
    );
    if (syncedMatch) return syncedMatch.planId as PlanId;

    const staticMatch = PLAN_CATALOG.find((plan) => plan.razorpayPlanId === razorpayPlanId);
    return staticMatch?.id ?? null;
}

export async function getPricingVariantForRazorpayPlanId(razorpayPlanId: string): Promise<PricingVariant | null> {
    const pricing = await getSyncedPricing();
    const syncedMatch = pricing.plans.find(
        (plan) => plan.razorpayPlanId === razorpayPlanId || plan.foundingRazorpayPlanId === razorpayPlanId,
    );
    if (!syncedMatch) {
        const staticMatch = PLAN_CATALOG.find((plan) => plan.razorpayPlanId === razorpayPlanId);
        return staticMatch ? 'standard' : null;
    }

    return syncedMatch.foundingRazorpayPlanId === razorpayPlanId ? 'founding' : 'standard';
}

/**
 * The authoritative money figure for a plan: what the member is charged, split
 * into GST-exclusive base and GST.
 *
 * The two payment paths derive it differently and must not be conflated:
 *
 *  - Class packs are one-time Orders whose amount OUR code sets, so the catalog
 *    price is the base and we add GST on top.
 *  - Memberships are Subscriptions charged whatever their Razorpay plan says, so
 *    that plan amount IS the total. The base comes from the plan's notes, or is
 *    backed out of the total when the plan predates GST.
 *
 * Deriving membership totals by adding GST to the catalog price would double-count
 * once GST-inclusive plans exist, and would understate the charge before they do.
 */
export function getChargeBreakdown(
    plan: PlanDefinition,
    syncedPlan: SyncedPlanEntry | null,
    isFoundingMember: boolean,
): GstBreakdown {
    const useFounding = isFoundingMember && !!plan.foundingPrice && plan.price > 0;

    if (plan.category === 'membership') {
        const totalPaise = useFounding
            ? syncedPlan?.foundingAmountPaise ?? null
            : syncedPlan?.amountPaise ?? null;

        if (typeof totalPaise === 'number' && totalPaise > 0) {
            const notedBase = useFounding ? syncedPlan?.foundingBasePaise : syncedPlan?.basePaise;
            if (typeof notedBase === 'number' && notedBase > 0 && notedBase <= totalPaise) {
                return { basePaise: notedBase, gstPaise: totalPaise - notedBase, totalPaise };
            }
            // Pre-GST plan: the amount charged is the whole story, no GST component.
            return { basePaise: totalPaise, gstPaise: 0, totalPaise };
        }
    }

    // Class packs, and memberships with no Razorpay plan yet: catalog price is the base.
    return applyGstToRupees(getChargeAmount(plan, syncedPlan, isFoundingMember));
}

export function getChargeAmount(plan: PlanDefinition, syncedPlan: SyncedPlanEntry | null, isFoundingMember: boolean): number {
    const basePrice = syncedPlan?.price ?? plan.price;
    if (!isFoundingMember || !plan.foundingPrice || plan.price <= 0) {
        return basePrice;
    }

    if (syncedPlan?.foundingPrice) {
        return syncedPlan.foundingPrice;
    }

    return Math.round(basePrice * (plan.foundingPrice / plan.price));
}
