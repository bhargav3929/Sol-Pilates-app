"use client"

import { Fragment, useState } from "react"
import { motion } from "framer-motion"
import { CheckCircle2, CheckIcon, SparklesIcon } from "lucide-react"
import { PLAN_CATALOG, type PlanId, type PlanDefinition } from "@fitconnect/shared/types/subscription"
import { cn } from "@/lib/utils"
import { applyGstToRupees, formatPaise, GST_RATE_PERCENT } from '@fitconnect/shared/utils/gst';

interface PlanSelectorProps {
    selectedPlanId: PlanId | null
    onSelect: (planId: PlanId) => void
    priceOverrides?: Partial<Record<string, number>>
}

function PlanCard({
    plan,
    isSelected,
    onSelect,
    displayPrice,
}: {
    plan: PlanDefinition
    isSelected: boolean
    onSelect: () => void
    displayPrice: number
}) {
    return (
        <motion.button
            onClick={onSelect}
            whileTap={{ scale: 0.97 }}
            className={cn(
                'relative w-full overflow-hidden rounded-2xl border text-left transition-all duration-200 flex flex-col',
                isSelected
                    ? 'border-terra-400 ring-2 ring-terra-400 bg-peach-50 shadow-lg shadow-terra-400/10'
                    : 'border-peach-400/20 bg-peach-50 hover:border-terra-400/30',
            )}
        >
            {/* Selection indicator */}
            {isSelected && (
                <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-terra-400 flex items-center justify-center">
                    <CheckIcon className="w-3.5 h-3.5 text-peach-50" strokeWidth={3} />
                </div>
            )}

            {plan.recommended && (
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-terra-400/50 to-transparent opacity-50" />
            )}

            <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                    <span className="px-2.5 py-1 rounded-md bg-terra-400 text-peach-50 text-[10px] font-black uppercase tracking-wider">
                        {plan.name}
                    </span>
                    {plan.recommended && (
                        <span className="px-2 py-1 rounded-md border border-terra-400/30 text-terra-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <SparklesIcon className="w-3 h-3" /> Popular
                        </span>
                    )}
                </div>

                <div className="flex items-end gap-1.5 mb-2">
                    <span className="font-mono text-3xl font-bold tracking-normal text-olive-600">
                        {displayPrice === 0 ? 'FREE' : formatPaise(applyGstToRupees(displayPrice).basePaise)}
                    </span>
                    <span className="text-olive-400 text-xs font-semibold pb-1">
                        {plan.category === 'membership' && plan.durationDays === 30
                            ? '/ month'
                            : plan.durationDays === 90
                                ? '/ quarter'
                                : plan.durationDays === 180
                                    ? '/ 6 months'
                                    : plan.credits === 1
                                        ? '/ session'
                                        : `/ ${plan.credits} classes`}
                    </span>
                </div>

                {displayPrice > 0 && (
                    <p className="text-olive-400/80 text-[11px] font-medium tracking-wide -mt-1 mb-2">
                        + {GST_RATE_PERCENT}% GST · {formatPaise(applyGstToRupees(displayPrice).totalPaise)} total
                    </p>
                )}

                <div className="text-olive-300 text-xs font-medium">
                    {plan.credits === null ? 'Unlimited classes' : `${plan.credits} credit${plan.credits !== 1 ? 's' : ''}`}
                    {' · '}
                    {plan.durationDays % 30 !== 0 ? `${plan.durationDays} days` : plan.durationDays === 30 ? '1 month' : `${plan.durationDays / 30} months`}
                </div>
            </div>
        </motion.button>
    )
}

export function PlanSelector({ selectedPlanId, onSelect, priceOverrides }: PlanSelectorProps) {
    const [activeTab, setActiveTab] = useState<'membership' | 'class_pack'>('membership')

    const memberships = PLAN_CATALOG.filter(p => p.category === 'membership')
    const classPacks = PLAN_CATALOG.filter(p => p.category === 'class_pack')
    const plans = activeTab === 'membership' ? memberships : classPacks

    return (
        <div className="space-y-6">
            {/* Tab toggle */}
            <div className="flex bg-peach-200/50 p-1 rounded-xl">
                <button
                    onClick={() => setActiveTab('membership')}
                    className={cn(
                        'flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all',
                        activeTab === 'membership'
                            ? 'bg-terra-400 text-peach-50 shadow-lg'
                            : 'text-olive-400 hover:text-olive-600',
                    )}
                >
                    Memberships
                </button>
                <button
                    onClick={() => setActiveTab('class_pack')}
                    className={cn(
                        'flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all',
                        activeTab === 'class_pack'
                            ? 'bg-terra-400 text-peach-50 shadow-lg'
                            : 'text-olive-400 hover:text-olive-600',
                    )}
                >
                    Class Packs
                </button>
            </div>

            {/* Plan cards */}
            <div className="grid gap-3">
                {plans.map((plan) => (
                    <Fragment key={plan.id}>
                        <PlanCard
                            plan={plan}
                            isSelected={selectedPlanId === plan.id}
                            onSelect={() => onSelect(plan.id)}
                            displayPrice={priceOverrides?.[plan.id] ?? plan.price}
                        />
                        {selectedPlanId === plan.id && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="px-5 py-4"
                            >
                                <p className="app-label mb-3">What you get</p>
                                <ul className="space-y-2">
                                    {plan.features.map((feature, i) => (
                                        <li key={i} className="flex items-start gap-2 text-olive-300 text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-terra-400 mt-0.5 shrink-0" />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </motion.div>
                        )}
                    </Fragment>
                ))}
            </div>
        </div>
    )
}
