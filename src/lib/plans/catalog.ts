import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import {
    PLAN_CATALOG,
    applyPlanOverrides,
    findPlan,
    type PlanDefinition,
    type PlanId,
    type PlanOverride,
    type PlanOverrideMap,
} from '@fitconnect/shared/types/subscription';

/**
 * Server-side access to the effective plan catalog.
 *
 * PLAN_CATALOG (shared/src/types/subscription.ts) holds the compiled-in
 * defaults. Admin edits made on /admin/plans are stored as sparse overrides in
 * `settings/planCatalog` and merged on top at read time. Every server path that
 * charges money or grants access must read through getEffectivePlan so that a
 * price or credit change in the admin panel is what customers actually get.
 */

export const PLAN_CATALOG_DOC = 'planCatalog';
const HISTORY_SUBCOLLECTION = 'history';

export interface PlanCatalogHistoryEntry {
    id: string;
    planId: PlanId;
    action: 'update' | 'reset';
    changes: Record<string, { from: unknown; to: unknown }>;
    razorpayPlanIds?: Record<string, string>;
    adminUid: string;
    adminEmail: string | null;
    createdAt: string | null;
}

function catalogRef() {
    return adminDb.collection('settings').doc(PLAN_CATALOG_DOC);
}

function sanitizeOverrides(raw: unknown): PlanOverrideMap {
    if (!raw || typeof raw !== 'object') return {};
    const result: PlanOverrideMap = {};
    for (const plan of PLAN_CATALOG) {
        const entry = (raw as Record<string, unknown>)[plan.id];
        if (entry && typeof entry === 'object') {
            result[plan.id] = entry as PlanOverride;
        }
    }
    return result;
}

export async function getPlanOverrides(): Promise<PlanOverrideMap> {
    try {
        const snap = await catalogRef().get();
        if (!snap.exists) return {};
        return sanitizeOverrides(snap.data()?.overrides);
    } catch (error) {
        console.error('[plans] failed to read overrides; using defaults', error);
        return {};
    }
}

/** Defaults merged with admin overrides, in catalog order. */
export async function getEffectiveCatalog(): Promise<PlanDefinition[]> {
    return applyPlanOverrides(await getPlanOverrides());
}

/** One effective plan, or undefined for an unknown id. */
export async function getEffectivePlan(planId: string): Promise<PlanDefinition | undefined> {
    return findPlan(await getEffectiveCatalog(), planId);
}

interface SaveOverrideInput {
    planId: PlanId;
    /** The complete override for this plan after the edit, or null to reset to defaults. */
    override: PlanOverride | null;
    changes: Record<string, { from: unknown; to: unknown }>;
    razorpayPlanIds?: Record<string, string>;
    adminUid: string;
    adminEmail: string | null;
}

/** Persists an override and appends an audit entry in the same batch. */
export async function savePlanOverride(input: SaveOverrideInput): Promise<void> {
    const batch = adminDb.batch();
    const ref = catalogRef();

    batch.set(
        ref,
        {
            overrides: { [input.planId]: input.override ?? FieldValue.delete() },
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: input.adminUid,
        },
        { merge: true },
    );

    batch.set(ref.collection(HISTORY_SUBCOLLECTION).doc(), {
        planId: input.planId,
        action: input.override ? 'update' : 'reset',
        changes: input.changes,
        razorpayPlanIds: input.razorpayPlanIds ?? null,
        adminUid: input.adminUid,
        adminEmail: input.adminEmail,
        createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
}

export async function getPlanCatalogHistory(limit = 25): Promise<PlanCatalogHistoryEntry[]> {
    const snap = await catalogRef()
        .collection(HISTORY_SUBCOLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

    return snap.docs.map((doc) => {
        const data = doc.data();
        const createdAt = data.createdAt && typeof data.createdAt.toDate === 'function'
            ? (data.createdAt.toDate() as Date).toISOString()
            : null;
        return {
            id: doc.id,
            planId: data.planId,
            action: data.action === 'reset' ? 'reset' : 'update',
            changes: data.changes ?? {},
            razorpayPlanIds: data.razorpayPlanIds ?? undefined,
            adminUid: data.adminUid ?? '',
            adminEmail: data.adminEmail ?? null,
            createdAt,
        };
    });
}
