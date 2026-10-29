import { describe, it, expect } from 'vitest';
import {
    PLAN_CATALOG,
    applyPlanOverride,
    applyPlanOverrides,
    findPlan,
    getPlanById,
    purchasablePlans,
} from '../../src/types/subscription';

describe('applyPlanOverride', () => {
    const tenPack = getPlanById('ten_class_pack')!;

    it('returns the same plan when there is no override', () => {
        expect(applyPlanOverride(tenPack, undefined)).toBe(tenPack);
    });

    it('overrides price, credits, validity and copy without touching identity fields', () => {
        const merged = applyPlanOverride(tenPack, {
            name: '12 Class Pack',
            price: 21000,
            credits: 12,
            durationDays: 90,
            tagline: 'Twelve classes.',
            features: ['12 credits', ' 90 days ', ''],
        });
        expect(merged.id).toBe('ten_class_pack');
        expect(merged.category).toBe('class_pack');
        expect(merged.name).toBe('12 Class Pack');
        expect(merged.price).toBe(21000);
        expect(merged.credits).toBe(12);
        expect(merged.durationDays).toBe(90);
        expect(merged.tagline).toBe('Twelve classes.');
        expect(merged.features).toEqual(['12 credits', '90 days']);
        // the default is untouched
        expect(tenPack.price).toBe(19000);
    });

    it('ignores blank names and invalid numbers', () => {
        const merged = applyPlanOverride(tenPack, { name: '   ', price: Number.NaN, durationDays: 0 });
        expect(merged.name).toBe(tenPack.name);
        expect(merged.price).toBe(tenPack.price);
        expect(merged.durationDays).toBe(tenPack.durationDays);
    });

    it('removes the founding offer when foundingPrice is null', () => {
        const quarterly = getPlanById('twice_quarterly')!;
        expect(quarterly.foundingPrice).toBe(34680);
        const merged = applyPlanOverride(quarterly, { foundingPrice: null });
        expect(merged.foundingPrice).toBeUndefined();
    });

    it('can hide a plan and change the recommended flag', () => {
        const merged = applyPlanOverride(tenPack, { hidden: true, recommended: true });
        expect(merged.hidden).toBe(true);
        expect(merged.recommended).toBe(true);
    });
});

describe('applyPlanOverrides', () => {
    it('keeps catalog order and length', () => {
        const catalog = applyPlanOverrides({ drop_in: { price: 1200 } });
        expect(catalog).toHaveLength(PLAN_CATALOG.length);
        expect(catalog.map((p) => p.id)).toEqual(PLAN_CATALOG.map((p) => p.id));
        expect(findPlan(catalog, 'drop_in')?.price).toBe(1200);
        expect(findPlan(catalog, 'single_session')?.price).toBe(2000);
    });

    it('returns the static catalog when overrides are absent', () => {
        expect(applyPlanOverrides(null)).toBe(PLAN_CATALOG);
    });

    it('purchasablePlans drops hidden plans only', () => {
        const catalog = applyPlanOverrides({ kickstarter: { hidden: true } });
        const ids = purchasablePlans(catalog).map((p) => p.id);
        expect(ids).not.toContain('kickstarter');
        expect(ids).toHaveLength(PLAN_CATALOG.length - 1);
    });
});
