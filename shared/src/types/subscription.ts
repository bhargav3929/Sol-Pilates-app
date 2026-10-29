// ---------------------------------------------------------------------------
// Plan catalog — Sol Pilates membership tiers (INR)
// ---------------------------------------------------------------------------

export type PlanId =
    | 'drop_in'
    | 'single_session'
    | 'kickstarter'
    | 'ten_class_pack'
    | 'twice_monthly'
    | 'twice_quarterly'
    | 'twice_6mo'
    | 'thrice_monthly'
    | 'thrice_quarterly'
    | 'thrice_6mo';

export type PlanCategory = 'membership' | 'class_pack';

export interface PlanDefinition {
    id: PlanId;
    name: string;
    category: PlanCategory;
    price: number;                    // INR rupees
    foundingPrice?: number;           // INR rupees, for first 25 members
    credits: number | null;           // null = unlimited
    durationDays: number;             // validity period
    maxClassesPerDay: number;
    weeklyClassLimit: number;
    advanceBookingDays: number;
    guestPasses: number;
    autoRenew: boolean;
    /** Razorpay Plan ID for membership subscriptions. Set by running scripts/create-razorpay-plans.ts. */
    razorpayPlanId?: string;
    /** Billing period for Razorpay (monthly + interval). */
    razorpayPeriod?: 'monthly';
    /** Billing interval in months (1 = monthly, 3 = quarterly, 6 = halfyearly). */
    razorpayInterval?: number;
    /** Total billing cycles before subscription completes (large = effectively indefinite). */
    razorpayTotalCount?: number;
    features: string[];
    tagline?: string;
    recommended?: boolean;
    requiresConsultation?: boolean;
    /** Hidden plans are not offered for purchase, but existing holders keep their access. */
    hidden?: boolean;
}

export const PLAN_CATALOG: PlanDefinition[] = [
    // ── Demo Class ────────────────────────────────────────────────
    {
        id: 'drop_in',
        name: 'Demo Class',
        category: 'class_pack',
        price: 1000,
        credits: 1,
        durationDays: 60,
        maxClassesPerDay: 1,
        weeklyClassLimit: 1,
        advanceBookingDays: 7,
        guestPasses: 0,
        autoRenew: false,
        tagline: 'Try a 30-minute demo class with no commitment.',
        features: [
            '1 demo 30-minute session',
            'SolMare coupon',
            'No commitment',
            'New clients only',
        ],
    },

    // ── Single drop-in class ─────────────────────────────────────
    {
        id: 'single_session',
        name: 'Single Drop-In',
        category: 'class_pack',
        price: 2000,
        credits: 1,
        durationDays: 30,
        maxClassesPerDay: 1,
        weeklyClassLimit: 1,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: false,
        tagline: 'One full class, whenever it suits you. No membership needed.',
        features: [
            '1 regular class credit',
            '30 days to use it',
            'Any class on the schedule',
            'No commitment',
        ],
    },

    // ── Intro program ────────────────────────────────────────────
    {
        id: 'kickstarter',
        name: 'Sol Intro Program',
        category: 'class_pack',
        price: 5000,
        credits: 4,
        durationDays: 45,
        maxClassesPerDay: 1,
        weeklyClassLimit: 2,
        advanceBookingDays: 45,
        guestPasses: 0,
        autoRenew: false,
        requiresConsultation: true,
        tagline: 'A guided two-week introduction to Pilates with Swetha, in-studio sessions, home workouts, and accountability support.',
        features: [
            '30-minute 1:1 session with Swetha',
            '2x in-studio sessions/week (4 sessions total)',
            '2x short home workouts/week',
            'Accountability support',
        ],
    },

    // ── 10-class pack ────────────────────────────────────────────
    {
        id: 'ten_class_pack',
        name: '10 Class Pack',
        category: 'class_pack',
        price: 19000,
        credits: 10,
        durationDays: 75,
        maxClassesPerDay: 1,
        // No weekly cap: one class a day is the only pacing limit.
        weeklyClassLimit: 7,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: false,
        tagline: 'Ten classes on your own schedule. No weekly cap, no auto-renewal.',
        features: [
            '10 regular class credits',
            '75 days to use them',
            'Book as often as you like',
            'No auto-renewal',
        ],
    },

    // ── 2x / week ────────────────────────────────────────────────
    {
        id: 'twice_monthly',
        name: '2x Weekly · Monthly',
        category: 'membership',
        price: 14400,
        credits: 8,
        durationDays: 30,
        maxClassesPerDay: 1,
        weeklyClassLimit: 2,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: true,
        razorpayPlanId: 'plan_TbsnQOrAyzbFk3',
        razorpayPeriod: 'monthly',
        razorpayInterval: 1,
        razorpayTotalCount: 72,
        tagline: 'Twice a week, billed monthly. The easiest way to get started.',
        features: [
            '2 classes per week',
            '1 month validity',
            '8 total credits',
            '14-day advance booking',
        ],
    },
    {
        id: 'twice_quarterly',
        name: '2x Weekly · Quarterly',
        category: 'membership',
        price: 40800,
        foundingPrice: 34680,
        credits: 24,
        durationDays: 90,
        maxClassesPerDay: 1,
        weeklyClassLimit: 2,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: true,
        razorpayPlanId: 'plan_T58k5yQT124ng8',
        razorpayPeriod: 'monthly',
        razorpayInterval: 3,
        razorpayTotalCount: 24,
        tagline: 'Twice a week, every week, for 3 months. Enough to build a real habit.',
        features: [
            '2 classes per week',
            '3 months validity',
            '24 total credits',
            '14-day advance booking',
        ],
    },
    {
        id: 'twice_6mo',
        name: '2x Weekly · 6 Months',
        category: 'membership',
        price: 72000,
        foundingPrice: 61200,
        credits: 48,
        durationDays: 180,
        maxClassesPerDay: 1,
        weeklyClassLimit: 2,
        advanceBookingDays: 14,
        guestPasses: 1,
        autoRenew: true,
        razorpayPlanId: 'plan_T58k6RZEEvRrZa',
        razorpayPeriod: 'monthly',
        razorpayInterval: 6,
        razorpayTotalCount: 12,
        tagline: 'Six months of showing up twice a week. This is where real change happens.',
        features: [
            '2 classes per week',
            '6 months validity',
            '48 total credits',
            '1 guest pass',
        ],
    },

    // ── 3x / week ────────────────────────────────────────────────
    {
        id: 'thrice_monthly',
        name: '3x Weekly · Monthly',
        category: 'membership',
        price: 21600,
        credits: 12,
        durationDays: 30,
        maxClassesPerDay: 1,
        weeklyClassLimit: 3,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: true,
        razorpayPlanId: 'plan_TbsnQsRQhc9kfE',
        razorpayPeriod: 'monthly',
        razorpayInterval: 1,
        razorpayTotalCount: 72,
        tagline: 'Three times a week, billed monthly. Build momentum without the long commitment.',
        features: [
            '3 classes per week',
            '1 month validity',
            '12 total credits',
            '14-day advance booking',
        ],
    },
    {
        id: 'thrice_quarterly',
        name: '3x Weekly · Quarterly',
        category: 'membership',
        price: 61200,
        foundingPrice: 52020,
        credits: 36,
        durationDays: 90,
        maxClassesPerDay: 1,
        weeklyClassLimit: 3,
        advanceBookingDays: 14,
        guestPasses: 0,
        autoRenew: true,
        razorpayPlanId: 'plan_T58k6wx7GWbLm2',
        razorpayPeriod: 'monthly',
        razorpayInterval: 3,
        razorpayTotalCount: 24,
        recommended: true,
        tagline: "Three times a week for 3 months. You'll feel it faster than you think.",
        features: [
            '3 classes per week',
            '3 months validity',
            '36 total credits',
            '14-day advance booking',
        ],
    },
    {
        id: 'thrice_6mo',
        name: '3x Weekly · 6 Months',
        category: 'membership',
        price: 108000,
        foundingPrice: 91800,
        credits: 72,
        durationDays: 180,
        maxClassesPerDay: 1,
        weeklyClassLimit: 3,
        advanceBookingDays: 14,
        guestPasses: 2,
        autoRenew: true,
        razorpayPlanId: 'plan_T58k7LFXFEkwRl',
        razorpayPeriod: 'monthly',
        razorpayInterval: 6,
        razorpayTotalCount: 12,
        tagline: 'Three days a week, six months in. Pain-free, stronger, and completely different.',
        features: [
            '3 classes per week',
            '6 months validity',
            '72 total credits',
            '2 guest passes',
        ],
    },
];

/** Look up a plan by ID. Returns undefined if not found. */
export function getPlanById(id: string): PlanDefinition | undefined {
    return PLAN_CATALOG.find((p) => p.id === id);
}

/** All valid plan IDs */
export const VALID_PLAN_IDS: PlanId[] = PLAN_CATALOG.map((p) => p.id);

/** Legacy mapping for backward compatibility with old plan IDs */
export const LEGACY_PLAN_MAP: Record<string, PlanId> = {
    weekly: 'twice_quarterly',
    monthly: 'twice_quarterly',
    quarterly: 'twice_quarterly',
    unlimited: 'thrice_6mo',
    twice_weekly: 'twice_quarterly',
    once_weekly: 'kickstarter',
    five_pack: 'twice_quarterly',
    ten_pack: 'twice_6mo',
};

// ---------------------------------------------------------------------------
// Admin overrides
//
// PLAN_CATALOG is the compiled-in default. Admins can adjust the fields below
// from /admin/plans; the overrides live in Firestore (settings/planCatalog) and
// are merged on top of the defaults by applyPlanOverrides. Plan IDs, category,
// and Razorpay billing period are fixed in code because booking, payment and
// webhook logic key off them.
// ---------------------------------------------------------------------------

export interface PlanOverride {
    name?: string;
    /** INR rupees, GST-exclusive. */
    price?: number;
    /** INR rupees, GST-exclusive. null removes the founding offer. */
    foundingPrice?: number | null;
    credits?: number | null;
    durationDays?: number;
    weeklyClassLimit?: number;
    guestPasses?: number;
    tagline?: string;
    features?: string[];
    recommended?: boolean;
    hidden?: boolean;
}

export type PlanOverrideMap = Partial<Record<PlanId, PlanOverride>>;

export const PLAN_OVERRIDE_LIMITS = {
    name: { min: 2, max: 60 },
    price: { min: 0, max: 1_000_000 },
    credits: { min: 0, max: 999 },
    durationDays: { min: 1, max: 730 },
    weeklyClassLimit: { min: 1, max: 7 },
    guestPasses: { min: 0, max: 20 },
    tagline: { max: 240 },
    features: { maxItems: 8, maxLength: 80 },
} as const;

export const PLAN_OVERRIDE_FIELDS = [
    'name',
    'price',
    'foundingPrice',
    'credits',
    'durationDays',
    'weeklyClassLimit',
    'guestPasses',
    'tagline',
    'features',
    'recommended',
    'hidden',
] as const satisfies ReadonlyArray<keyof PlanOverride>;

/** Merges one override onto a plan. Undefined fields keep the default. */
export function applyPlanOverride(plan: PlanDefinition, override: PlanOverride | undefined): PlanDefinition {
    if (!override) return plan;
    const merged: PlanDefinition = { ...plan };
    if (typeof override.name === 'string' && override.name.trim()) merged.name = override.name.trim();
    if (typeof override.price === 'number' && Number.isFinite(override.price)) merged.price = override.price;
    if (override.foundingPrice === null) {
        delete merged.foundingPrice;
    } else if (typeof override.foundingPrice === 'number' && Number.isFinite(override.foundingPrice)) {
        merged.foundingPrice = override.foundingPrice;
    }
    if (override.credits === null || (typeof override.credits === 'number' && Number.isFinite(override.credits))) {
        merged.credits = override.credits;
    }
    if (typeof override.durationDays === 'number' && override.durationDays > 0) merged.durationDays = override.durationDays;
    if (typeof override.weeklyClassLimit === 'number' && override.weeklyClassLimit > 0) merged.weeklyClassLimit = override.weeklyClassLimit;
    if (typeof override.guestPasses === 'number' && override.guestPasses >= 0) merged.guestPasses = override.guestPasses;
    if (typeof override.tagline === 'string') merged.tagline = override.tagline.trim() || undefined;
    if (Array.isArray(override.features)) {
        merged.features = override.features.map((f) => String(f).trim()).filter(Boolean);
    }
    if (typeof override.recommended === 'boolean') merged.recommended = override.recommended;
    if (typeof override.hidden === 'boolean') merged.hidden = override.hidden;
    return merged;
}

/** The catalog as customers should see it: defaults with admin overrides applied. */
export function applyPlanOverrides(
    overrides: PlanOverrideMap | null | undefined,
    catalog: PlanDefinition[] = PLAN_CATALOG,
): PlanDefinition[] {
    if (!overrides) return catalog;
    return catalog.map((plan) => applyPlanOverride(plan, overrides[plan.id]));
}

/** Look up a plan in an effective catalog (falls back to the static catalog). */
export function findPlan(catalog: PlanDefinition[] | null | undefined, id: string): PlanDefinition | undefined {
    return (catalog ?? PLAN_CATALOG).find((p) => p.id === id);
}

/** Plans a customer may buy right now. */
export function purchasablePlans(catalog: PlanDefinition[]): PlanDefinition[] {
    return catalog.filter((p) => !p.hidden);
}
