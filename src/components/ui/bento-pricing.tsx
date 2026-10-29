'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckIcon, SparklesIcon } from 'lucide-react';
import { PLAN_CATALOG, purchasablePlans, type PlanDefinition } from '@fitconnect/shared/types/subscription';
import { applyGstToRupees, formatPaise, GST_RATE_PERCENT, type GstBreakdown } from '@fitconnect/shared/utils/gst';
import { useIntroClassLead } from '@/lib/hooks/useIntroClassLead';
import { callGetPricing } from '@fitconnect/shared/firebase/firestore';

function FilledCheck() {
    return (
        <div className="bg-terra-400 text-peach-50 rounded-full p-0.5 shrink-0">
            <CheckIcon className="size-3" strokeWidth={3} />
        </div>
    );
}

function FilledCheckDark() {
    return (
        <div className="bg-terra-300 text-warmDark-900 rounded-full p-0.5 shrink-0">
            <CheckIcon className="size-3" strokeWidth={3} />
        </div>
    );
}

function formatPrice(rupees: number) {
    if (rupees === 0) return 'FREE';
    return `₹${rupees.toLocaleString('en-IN')}`;
}

/**
 * Headline is the pre-tax price. GST is added at checkout, so the note spells out
 * both the rate and the amount that will actually be charged - a customer should
 * never reach Razorpay and meet a number this page never showed them.
 */
function formatCharge(charge: GstBreakdown) {
    if (charge.basePaise === 0) return 'FREE';
    return formatPaise(charge.basePaise);
}

function GstNote({ charge, className }: { charge: GstBreakdown; className?: string }) {
    if (charge.gstPaise <= 0) return null;
    return (
        <p className={cn('text-[11px] font-medium tracking-wide mt-1', className ?? 'text-olive-400/80')}>
            + {GST_RATE_PERCENT}% GST · {formatPaise(charge.totalPaise)} total
        </p>
    );
}

function priceSuffix(plan: PlanDefinition) {
    if (plan.id === 'drop_in') return '/ session';
    if (plan.category === 'class_pack') {
        if (plan.credits === 1) return '/ class';
        if (plan.credits && plan.credits > 1) return `/ ${plan.credits} classes`;
        return '';
    }
    if (plan.durationDays === 30) return '/ month';
    if (plan.durationDays === 90) return '/ quarter';
    if (plan.durationDays === 180) return '/ 6 months';
    return '';
}

function getPerClassPrice(plan: PlanDefinition): string | null {
    if (!plan.credits || plan.credits <= 1) return null;
    const perClass = Math.round(plan.price / plan.credits);
    return `≈ ₹${perClass.toLocaleString('en-IN')} / class`;
}

function SectionLabel({ label, accent }: { label: string; accent?: boolean }) {
    return (
        <div className="flex items-center gap-3">
            <span className={cn(
                'text-xs font-black uppercase tracking-[0.15em]',
                accent ? 'text-terra-400' : 'text-olive-500',
            )}>
                {label}
            </span>
            <div className={cn('flex-1 h-px', accent ? 'bg-terra-400/25' : 'bg-peach-400/30')} />
        </div>
    );
}

function IntroCard({
    plan,
    onSelect,
    cta,
    featured,
    ctaDisabled,
    displayPrice,
    charge,
}: {
    plan: PlanDefinition;
    onSelect: (id: string) => void;
    cta: string;
    featured?: boolean;
    ctaDisabled?: boolean;
    displayPrice?: number;
    charge?: GstBreakdown;
}) {
    const price = displayPrice ?? plan.price;
    const chargeBreakdown = charge ?? applyGstToRupees(price);
    return (
        <div className={cn(
            'relative overflow-hidden rounded-2xl border flex flex-col bg-peach-50 transition-all duration-300',
            featured
                ? 'border-terra-400/50 ring-1 ring-terra-400/20 hover:ring-terra-400/40'
                : 'border-peach-400/30 hover:border-terra-400/30',
        )}>
            {featured && (
                <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-terra-400 to-transparent" />
            )}

            <div className="p-6 pb-0 flex flex-wrap items-center justify-between gap-2">
                <Badge className="bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wider uppercase text-xs px-3 whitespace-nowrap">
                    {plan.name}
                </Badge>
                {featured && (
                    <span className="text-[10px] text-terra-400 font-black tracking-[0.15em] uppercase flex items-center gap-1">
                        <SparklesIcon className="size-3" />
                        Best Intro
                    </span>
                )}
            </div>

            <div className="p-6 pt-4 flex flex-col h-full">
                {/* Four cards share a row on desktop, so the suffix wraps under a long price. */}
                <div className="flex flex-wrap items-end gap-x-2 mb-1">
                    <span className="font-mono text-4xl font-bold tracking-tight text-olive-600 whitespace-nowrap">
                        {formatCharge(chargeBreakdown)}
                    </span>
                    <span className="text-olive-400 text-xs font-semibold uppercase pb-1.5 whitespace-nowrap">
                        {priceSuffix(plan)}
                    </span>
                </div>
                <GstNote charge={chargeBreakdown} />

                {plan.tagline && (
                    <p className="text-olive-400 text-sm leading-relaxed mt-3 mb-5 border-b border-peach-400/20 pb-5">
                        {plan.tagline}
                    </p>
                )}

                <ul className="space-y-3 text-sm text-olive-400 flex-grow">
                    {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <FilledCheck />
                            <span className="leading-tight">{f}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-8">
                    <Button
                        onClick={() => !ctaDisabled && onSelect(plan.id)}
                        disabled={ctaDisabled}
                        aria-disabled={ctaDisabled}
                        className={cn(
                            'w-full font-bold tracking-wide h-12 rounded-xl',
                            ctaDisabled
                                ? 'bg-peach-100 text-olive-400 hover:bg-peach-100 cursor-not-allowed border border-peach-400/30'
                                : 'bg-terra-400 text-peach-50 hover:bg-terra-300',
                        )}
                    >
                        {cta}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function HighlightedMembershipCard({
    plan,
    onSelect,
    displayPrice,
    charge,
    foundingCharge,
}: {
    plan: PlanDefinition;
    onSelect: (id: string) => void;
    displayPrice?: number;
    charge?: GstBreakdown;
    foundingCharge?: GstBreakdown | null;
}) {
    const price = displayPrice ?? plan.price;
    const chargeBreakdown = charge ?? applyGstToRupees(price);
    // Both sides of the saving must be on the same tax basis. `price` arrives from
    // the pricing API GST-INCLUSIVE for memberships, so subtracting the pre-tax
    // foundingPrice from it would overstate the discount.
    const foundingBreakdown = plan.foundingPrice
        ? foundingCharge ?? applyGstToRupees(plan.foundingPrice)
        : null;
    const foundingSavingPaise = foundingBreakdown
        ? chargeBreakdown.basePaise - foundingBreakdown.basePaise
        : 0;
    const perClass = price > 0 && plan.credits && plan.credits > 1
        ? `≈ ₹${Math.round(price / plan.credits).toLocaleString('en-IN')} / class`
        : getPerClassPrice(plan);

    return (
        <div className={cn(
            'relative overflow-hidden flex flex-col rounded-2xl',
            'border-2 border-terra-400 bg-warmDark-800',
            'md:-translate-y-4',
            'shadow-glow-lg transition-all duration-300',
            'hover:shadow-[0_0_60px_rgba(218,96,39,0.45)]',
        )}>
            {/* Most Popular ribbon */}
            <div className="bg-terra-400 py-2.5 text-center">
                <span className="text-peach-50 text-xs font-black tracking-[0.2em] uppercase">
                    ★&nbsp;&nbsp;Most Popular&nbsp;&nbsp;★
                </span>
            </div>

            <div className="p-6 pb-0 flex items-center justify-between">
                <Badge className="bg-terra-400/20 text-terra-300 border border-terra-400/40 font-bold tracking-wider uppercase text-xs px-3">
                    {plan.name}
                </Badge>
                {plan.foundingPrice && (
                    <span className="text-[10px] text-gold-300 font-black tracking-[0.12em] uppercase">
                        Founding Offer
                    </span>
                )}
            </div>

            <div className="p-6 pt-4 flex flex-col h-full">
                <div className="mb-1">
                    <div className="flex items-end gap-1.5">
                        <span className="font-mono text-4xl font-bold tracking-tight text-peach-50">
                            {formatCharge(chargeBreakdown)}
                        </span>
                        <span className="text-peach-300 text-xs font-semibold uppercase pb-1.5">
                            {priceSuffix(plan)}
                        </span>
                    </div>
                    <GstNote charge={chargeBreakdown} className="text-peach-300/90" />
                    {perClass && (
                        <p className="text-terra-300 text-xs font-bold uppercase tracking-widest mt-1.5">
                            {perClass}
                        </p>
                    )}
                </div>

                {plan.foundingPrice && (
                    <div className="mt-4 mb-5 rounded-xl bg-terra-400/10 border border-terra-400/25 px-4 py-3">
                        <p className="text-[10px] text-peach-400 uppercase tracking-widest font-bold mb-1">
                            Founding Member Price
                        </p>
                        <p className="text-gold-300 font-black text-2xl leading-none">
                            {foundingBreakdown ? formatPaise(foundingBreakdown.basePaise) : formatPrice(plan.foundingPrice)}
                        </p>
                        {foundingBreakdown && foundingBreakdown.gstPaise > 0 && (
                            <p className="text-peach-400/90 text-[10px] mt-1">
                                + {GST_RATE_PERCENT}% GST · {formatPaise(foundingBreakdown.totalPaise)} total
                            </p>
                        )}
                        <p className="text-peach-400 text-[10px] mt-1">
                            First 25 members only · Save {formatPaise(foundingSavingPaise)}
                        </p>
                    </div>
                )}

                {plan.tagline && (
                    <p className="text-peach-300 text-sm leading-relaxed mb-5 border-b border-peach-50/10 pb-5">
                        {plan.tagline}
                    </p>
                )}

                <ul className="space-y-3.5 text-sm text-peach-200 flex-grow">
                    {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <FilledCheckDark />
                            <span className="leading-tight">{f}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-8">
                    <Button
                        onClick={() => onSelect(plan.id)}
                        className="w-full font-bold tracking-wide h-12 rounded-xl bg-terra-400 text-peach-50 hover:bg-terra-300 shadow-glow"
                    >
                        SUBSCRIBE NOW
                    </Button>
                </div>
            </div>
        </div>
    );
}

function MembershipCard({
    plan,
    onSelect,
    displayPrice,
    charge,
    foundingCharge,
}: {
    plan: PlanDefinition;
    onSelect: (id: string) => void;
    displayPrice?: number;
    charge?: GstBreakdown;
    foundingCharge?: GstBreakdown | null;
}) {
    const price = displayPrice ?? plan.price;
    const chargeBreakdown = charge ?? applyGstToRupees(price);
    // Both sides of the saving must be on the same tax basis. `price` arrives from
    // the pricing API GST-INCLUSIVE for memberships, so subtracting the pre-tax
    // foundingPrice from it would overstate the discount.
    const foundingBreakdown = plan.foundingPrice
        ? foundingCharge ?? applyGstToRupees(plan.foundingPrice)
        : null;
    const foundingSavingPaise = foundingBreakdown
        ? chargeBreakdown.basePaise - foundingBreakdown.basePaise
        : 0;
    const perClass = getPerClassPrice(plan);

    return (
        <div className={cn(
            'relative overflow-hidden rounded-2xl border flex flex-col',
            'bg-peach-50 border-peach-400/30 transition-all duration-300',
            'hover:border-terra-400/30',
        )}>
            <div className="p-6 pb-0 flex items-center justify-between">
                <Badge className="bg-terra-400 text-peach-50 hover:bg-terra-300 font-bold tracking-wider uppercase text-xs px-3">
                    {plan.name}
                </Badge>
            </div>

            <div className="p-6 pt-4 flex flex-col h-full">
                <div className="mb-1">
                    <div className="flex items-end gap-1.5">
                        <span className="font-mono text-3xl font-bold tracking-tight text-olive-600">
                            {formatCharge(chargeBreakdown)}
                        </span>
                        <span className="text-olive-400 text-xs font-semibold uppercase pb-1.5">
                            {priceSuffix(plan)}
                        </span>
                    </div>
                    <GstNote charge={chargeBreakdown} />
                    {/* Removed PerClass price */}
                    {/* {perClass && (
                        <p className="text-olive-400 text-xs font-bold uppercase tracking-widest mt-1.5">
                            {perClass}
                        </p>
                    )} */}
                </div>

                {plan.foundingPrice && (
                    <div className="mt-4 mb-5 rounded-xl bg-terra-400/5 border border-terra-400/20 px-4 py-3">
                        <p className="text-[10px] text-olive-400 uppercase tracking-widest font-bold mb-1">
                            Founding Member
                        </p>
                        <p className="text-terra-400 font-black text-xl leading-none">
                            {foundingBreakdown ? formatPaise(foundingBreakdown.basePaise) : formatPrice(plan.foundingPrice)}
                        </p>
                        {foundingBreakdown && foundingBreakdown.gstPaise > 0 && (
                            <p className="text-olive-400/80 text-[10px] mt-1">
                                + {GST_RATE_PERCENT}% GST · {formatPaise(foundingBreakdown.totalPaise)} total
                            </p>
                        )}
                        <p className="text-olive-300 text-[10px] mt-1">
                            First 25 only · Save {formatPaise(foundingSavingPaise)}
                        </p>
                    </div>
                )}

                {plan.tagline && (
                    <p className="text-olive-300 text-sm leading-relaxed mb-5 border-b border-peach-400/20 pb-5">
                        {plan.tagline}
                    </p>
                )}

                <ul className="space-y-3 text-sm text-olive-400 flex-grow">
                    {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-3">
                            <FilledCheck />
                            <span className="leading-tight">{f}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-8">
                    <Button
                        onClick={() => onSelect(plan.id)}
                        className="w-full font-bold tracking-wide h-12 rounded-xl bg-terra-400 text-peach-50 hover:bg-terra-300"
                    >
                        SUBSCRIBE
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function BentoPricing() {
    const router = useRouter();
    const { hasIntroClassLead } = useIntroClassLead();
    const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
    const [chargeOverrides, setChargeOverrides] = useState<Record<string, GstBreakdown>>({});
    const [foundingChargeOverrides, setFoundingChargeOverrides] = useState<Record<string, GstBreakdown>>({});
    // Defaults + admin edits (names, copy, prices, hidden plans). Static catalog is the fallback.
    const [catalog, setCatalog] = useState<PlanDefinition[]>(PLAN_CATALOG);

    useEffect(() => {
        callGetPricing()
            .then(data => {
                if (data.catalog?.length) setCatalog(data.catalog);
                const overrides: Record<string, number> = {};
                const charges: Record<string, GstBreakdown> = {};
                const foundingCharges: Record<string, GstBreakdown> = {};
                for (const p of data.plans) {
                    if (p.configured) overrides[p.planId] = p.price;
                    // Server-derived so the page can never quote a figure checkout disagrees with.
                    if (p.charge) charges[p.planId] = p.charge;
                    if (p.foundingCharge) foundingCharges[p.planId] = p.foundingCharge;
                }
                setPriceOverrides(overrides);
                setChargeOverrides(charges);
                setFoundingChargeOverrides(foundingCharges);
            })
            .catch(() => {/* use hardcoded fallback */});
    }, []);

    const handleSelect = (planId: string) => {
        if (planId === 'drop_in') {
            if (hasIntroClassLead === true) return;
            router.push('/intro-class');
            return;
        }
        router.push(`/user/subscribe?plan=${planId}`);
    };

    const visible = purchasablePlans(catalog);
    const classPacks = visible.filter((p) => p.category === 'class_pack');
    const memberships = visible.filter((p) => p.category === 'membership');

    const packCta = (plan: PlanDefinition): { cta: string; disabled?: boolean; featured?: boolean } => {
        if (plan.id === 'drop_in') {
            return { cta: hasIntroClassLead === true ? 'DEMO CLASS BOOKED' : 'BOOK DEMO CLASS', disabled: hasIntroClassLead === true };
        }
        if (plan.id === 'single_session') return { cta: 'BOOK A CLASS' };
        if (plan.id === 'kickstarter') return { cta: 'START KICKSTARTER', featured: true };
        if (plan.credits && plan.credits > 1) return { cta: `BUY ${plan.credits} CLASSES` };
        return { cta: 'BUY NOW' };
    };

    const packGridCols = classPacks.length >= 4
        ? 'lg:grid-cols-4'
        : classPacks.length === 3
            ? 'lg:grid-cols-3'
            : 'lg:grid-cols-2';

    return (
        <div className="space-y-24">
            {/* SECTION 1: TRY IT */}
            {classPacks.length > 0 && (
                <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto', packGridCols)}>
                    {classPacks.map((plan) => {
                        const { cta, disabled, featured } = packCta(plan);
                        return (
                            <IntroCard
                                key={plan.id}
                                plan={plan}
                                onSelect={handleSelect}
                                cta={cta}
                                ctaDisabled={disabled}
                                featured={featured}
                                displayPrice={priceOverrides[plan.id]}
                                charge={chargeOverrides[plan.id]}
                            />
                        );
                    })}
                </div>
            )}

            {/* SECTION 2: MEMBERSHIPS */}
            <div className="space-y-6">
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-10 bg-terra-400/40" />
                    <h2 className="text-3xl md:text-4xl font-black tracking-normal uppercase text-terra-400 font-display">
                        Memberships
                    </h2>
                    <div className="h-px w-10 bg-terra-400/40" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start pt-4">
                    {memberships.map((plan) =>
                        plan.recommended ? (
                            <HighlightedMembershipCard
                                key={plan.id}
                                plan={plan}
                                onSelect={handleSelect}
                                displayPrice={priceOverrides[plan.id]}
                                charge={chargeOverrides[plan.id]}
                                foundingCharge={foundingChargeOverrides[plan.id]}
                            />
                        ) : (
                            <MembershipCard
                                key={plan.id}
                                plan={plan}
                                onSelect={handleSelect}
                                displayPrice={priceOverrides[plan.id]}
                                charge={chargeOverrides[plan.id]}
                                foundingCharge={foundingChargeOverrides[plan.id]}
                            />
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
