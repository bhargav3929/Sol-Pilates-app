"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    callAdminResetPlan,
    callAdminUpdatePlan,
    type AdminPlanEntry,
} from "@fitconnect/shared/firebase/firestore"
import { PLAN_OVERRIDE_LIMITS, type PlanOverride } from "@fitconnect/shared/types/subscription"
import { applyGstToRupees, formatPaise, GST_RATE_PERCENT } from "@fitconnect/shared/utils/gst"

const fieldClass = "w-full h-11 px-4 bg-peach-200/30 border border-peach-400/15 text-olive-600 placeholder:text-olive-300/40 focus:border-terra-400/50 focus:bg-peach-50 focus:outline-none transition-all text-sm disabled:opacity-50"
const labelClass = "block text-[11px] font-bold text-olive-400 tracking-[0.15em] uppercase mb-1.5"
const helpClass = "text-[11px] text-olive-300 mt-1"
const secondaryButton = "h-11 px-5 border border-peach-400/25 text-olive-500 text-xs font-bold tracking-[0.2em] uppercase hover:bg-peach-200/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
const primaryButton = "h-11 px-6 bg-terra-400 text-peach-50 text-xs font-bold tracking-[0.2em] uppercase hover:bg-terra-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"

interface FormState {
    name: string
    price: string
    hasFounding: boolean
    foundingPrice: string
    unlimited: boolean
    credits: string
    durationDays: string
    weeklyClassLimit: string
    guestPasses: string
    tagline: string
    features: string
    recommended: boolean
    hidden: boolean
}

function toForm(entry: AdminPlanEntry): FormState {
    const p = entry.plan
    return {
        name: p.name,
        price: String(p.price),
        hasFounding: p.foundingPrice !== undefined && p.foundingPrice !== null,
        foundingPrice: p.foundingPrice ? String(p.foundingPrice) : "",
        unlimited: p.credits === null,
        credits: p.credits === null ? "" : String(p.credits),
        durationDays: String(p.durationDays),
        weeklyClassLimit: String(p.weeklyClassLimit),
        guestPasses: String(p.guestPasses),
        tagline: p.tagline ?? "",
        features: p.features.join("\n"),
        recommended: !!p.recommended,
        hidden: !!p.hidden,
    }
}

function parseInt10(value: string, label: string, min: number, max: number): number {
    const n = Number(value)
    if (value.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${label} must be a whole number between ${min} and ${max}`)
    }
    return n
}

function toOverride(form: FormState, isMembership: boolean): PlanOverride {
    const L = PLAN_OVERRIDE_LIMITS
    const name = form.name.trim()
    if (name.length < L.name.min || name.length > L.name.max) {
        throw new Error(`Name must be ${L.name.min} to ${L.name.max} characters`)
    }
    const price = parseInt10(form.price, "Price", L.price.min, L.price.max)
    if (isMembership && price <= 0) throw new Error("Membership price must be greater than zero")

    let foundingPrice: number | null = null
    if (form.hasFounding) {
        foundingPrice = parseInt10(form.foundingPrice, "Founding price", 1, L.price.max)
        if (foundingPrice >= price) throw new Error("Founding price must be lower than the standard price")
    }

    const credits = form.unlimited ? null : parseInt10(form.credits, "Credits", L.credits.min, L.credits.max)
    const features = form.features
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
    if (features.length > L.features.maxItems) throw new Error(`At most ${L.features.maxItems} feature lines`)
    for (const f of features) {
        if (f.length > L.features.maxLength) throw new Error(`Feature lines must be ${L.features.maxLength} characters or fewer`)
    }
    const tagline = form.tagline.trim()
    if (tagline.length > L.tagline.max) throw new Error(`Tagline must be ${L.tagline.max} characters or fewer`)

    return {
        name,
        price,
        foundingPrice,
        credits,
        durationDays: parseInt10(form.durationDays, "Validity", L.durationDays.min, L.durationDays.max),
        weeklyClassLimit: parseInt10(form.weeklyClassLimit, "Classes per week", L.weeklyClassLimit.min, L.weeklyClassLimit.max),
        guestPasses: parseInt10(form.guestPasses, "Guest passes", L.guestPasses.min, L.guestPasses.max),
        tagline,
        features,
        recommended: form.recommended,
        hidden: form.hidden,
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Something went wrong"
}

export function PlanEditDialog({
    entry,
    onClose,
    onSaved,
}: {
    entry: AdminPlanEntry | null
    onClose: () => void
    onSaved: (updated: AdminPlanEntry) => void
}) {
    // The parent remounts this dialog per plan (via key), so the initial form
    // can be taken straight from props.
    const [form, setForm] = useState<FormState>(() => (entry ? toForm(entry) : ({} as FormState)))
    const [isSaving, setIsSaving] = useState(false)
    const [confirmBilling, setConfirmBilling] = useState(false)

    const isMembership = entry?.plan.category === "membership"
    const priceNumber = Number(form.price)
    const charge = Number.isFinite(priceNumber) && priceNumber > 0 ? applyGstToRupees(priceNumber) : null
    const foundingNumber = Number(form.foundingPrice)
    const foundingCharge = form.hasFounding && Number.isFinite(foundingNumber) && foundingNumber > 0
        ? applyGstToRupees(foundingNumber)
        : null

    const billingChanges = useMemo(() => {
        if (!entry || !isMembership) return false
        const priceChanged = priceNumber !== entry.plan.price
        const foundingBefore = entry.plan.foundingPrice ?? null
        const foundingAfter = form.hasFounding ? foundingNumber : null
        const foundingChanged = foundingAfter !== foundingBefore
        const nameChanged = form.name.trim() !== entry.plan.name
        return priceChanged || foundingChanged || nameChanged
    }, [entry, isMembership, priceNumber, foundingNumber, form.hasFounding, form.name])

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }))

    const handleSave = async () => {
        if (!entry) return
        let override: PlanOverride
        try {
            override = toOverride(form, isMembership)
        } catch (error) {
            toast.error(errorMessage(error))
            return
        }
        if (billingChanges && !confirmBilling) {
            setConfirmBilling(true)
            return
        }
        setIsSaving(true)
        try {
            const result = await callAdminUpdatePlan(entry.plan.id, override)
            const created = result.razorpayPlanIds ? Object.keys(result.razorpayPlanIds) : []
            toast.success(`${override.name} saved`, {
                description: created.length
                    ? `New Razorpay plan created for ${created.join(" and ")} billing. New members pay the new price.`
                    : "Live on the website and app.",
            })
            onSaved(result.plan)
            onClose()
        } catch (error) {
            toast.error("Could not save plan", { description: errorMessage(error) })
        } finally {
            setIsSaving(false)
        }
    }

    const handleReset = async () => {
        if (!entry) return
        setIsSaving(true)
        try {
            const result = await callAdminResetPlan(entry.plan.id)
            toast.success(`${entry.defaults.name} reset to defaults`)
            onSaved(result.plan)
            onClose()
        } catch (error) {
            toast.error("Could not reset plan", { description: errorMessage(error) })
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={!!entry} onOpenChange={(open) => !open && !isSaving && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-peach-100 border-peach-400/30 rounded-none p-0">
                {entry && (
                    <>
                        <DialogHeader className="px-8 pt-8 pb-6 border-b border-peach-400/20">
                            <DialogTitle className="text-2xl font-black text-olive-600 tracking-tight">
                                Edit {entry.defaults.name}
                            </DialogTitle>
                            <DialogDescription className="text-olive-400 text-sm">
                                {isMembership
                                    ? "Membership. Billed by Razorpay on a recurring plan."
                                    : "Class pack. Paid once; credits expire after the validity period."}
                                {" "}Changes go live on the website and app as soon as you save.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="px-8 py-6 space-y-6">
                            {/* Identity */}
                            <div>
                                <label className={labelClass} htmlFor="plan-name">Name</label>
                                <input
                                    id="plan-name"
                                    className={fieldClass}
                                    value={form.name}
                                    maxLength={PLAN_OVERRIDE_LIMITS.name.max}
                                    onChange={(e) => set("name", e.target.value)}
                                />
                            </div>

                            {/* Pricing */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div>
                                    <label className={labelClass} htmlFor="plan-price">Price (₹, before GST)</label>
                                    <input
                                        id="plan-price"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        value={form.price}
                                        onChange={(e) => set("price", e.target.value)}
                                    />
                                    <p className={helpClass}>
                                        {charge
                                            ? `+ ${GST_RATE_PERCENT}% GST · customer pays ${formatPaise(charge.totalPaise)}`
                                            : priceNumber === 0 ? "Free" : "Enter a whole rupee amount"}
                                    </p>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className={labelClass.replace(" mb-1.5", "")} htmlFor="plan-founding">Founding price</label>
                                        <label className="flex items-center gap-2 text-[11px] text-olive-400 font-semibold cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="accent-terra-400"
                                                checked={form.hasFounding}
                                                onChange={(e) => set("hasFounding", e.target.checked)}
                                            />
                                            Offer
                                        </label>
                                    </div>
                                    <input
                                        id="plan-founding"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        step={1}
                                        disabled={!form.hasFounding}
                                        placeholder="No founding offer"
                                        value={form.hasFounding ? form.foundingPrice : ""}
                                        onChange={(e) => set("foundingPrice", e.target.value)}
                                    />
                                    <p className={helpClass}>
                                        {foundingCharge
                                            ? `First 25 members pay ${formatPaise(foundingCharge.totalPaise)} incl. GST`
                                            : "Discounted rate for the first 25 members"}
                                    </p>
                                </div>
                            </div>

                            {/* Entitlements */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className={labelClass.replace(" mb-1.5", "")} htmlFor="plan-credits">Credits</label>
                                        <label className="flex items-center gap-1.5 text-[11px] text-olive-400 font-semibold cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="accent-terra-400"
                                                checked={form.unlimited}
                                                onChange={(e) => set("unlimited", e.target.checked)}
                                            />
                                            ∞
                                        </label>
                                    </div>
                                    <input
                                        id="plan-credits"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        disabled={form.unlimited}
                                        placeholder={form.unlimited ? "Unlimited" : ""}
                                        value={form.unlimited ? "" : form.credits}
                                        onChange={(e) => set("credits", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass} htmlFor="plan-days">Validity (days)</label>
                                    <input
                                        id="plan-days"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        step={1}
                                        value={form.durationDays}
                                        onChange={(e) => set("durationDays", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass} htmlFor="plan-weekly">Per week</label>
                                    <input
                                        id="plan-weekly"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={7}
                                        step={1}
                                        value={form.weeklyClassLimit}
                                        onChange={(e) => set("weeklyClassLimit", e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass} htmlFor="plan-guests">Guest passes</label>
                                    <input
                                        id="plan-guests"
                                        className={fieldClass}
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        value={form.guestPasses}
                                        onChange={(e) => set("guestPasses", e.target.value)}
                                    />
                                </div>
                            </div>
                            <p className={helpClass + " -mt-3"}>
                                Credits, validity and weekly limit apply to purchases made after you save. Members already on this plan keep what they were granted.
                            </p>

                            {/* Copy */}
                            <div>
                                <label className={labelClass} htmlFor="plan-tagline">Tagline</label>
                                <textarea
                                    id="plan-tagline"
                                    className={fieldClass + " h-auto py-3 resize-none"}
                                    rows={2}
                                    maxLength={PLAN_OVERRIDE_LIMITS.tagline.max}
                                    value={form.tagline}
                                    onChange={(e) => set("tagline", e.target.value)}
                                />
                            </div>
                            <div>
                                <label className={labelClass} htmlFor="plan-features">What&apos;s included</label>
                                <textarea
                                    id="plan-features"
                                    className={fieldClass + " h-auto py-3 resize-none font-mono text-xs leading-6"}
                                    rows={5}
                                    value={form.features}
                                    onChange={(e) => set("features", e.target.value)}
                                />
                                <p className={helpClass}>One line per bullet, up to {PLAN_OVERRIDE_LIMITS.features.maxItems}.</p>
                            </div>

                            {/* Flags */}
                            <div className="flex flex-wrap gap-6">
                                <label className="flex items-center gap-2.5 text-sm text-olive-500 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="accent-terra-400 w-4 h-4"
                                        checked={!form.hidden}
                                        onChange={(e) => set("hidden", !e.target.checked)}
                                    />
                                    <span>
                                        <span className="font-bold">Visible</span>
                                        <span className="text-olive-300"> · shown on the website and app</span>
                                    </span>
                                </label>
                                <label className="flex items-center gap-2.5 text-sm text-olive-500 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="accent-terra-400 w-4 h-4"
                                        checked={form.recommended}
                                        onChange={(e) => set("recommended", e.target.checked)}
                                    />
                                    <span>
                                        <span className="font-bold">Most popular</span>
                                        <span className="text-olive-300"> · highlighted badge</span>
                                    </span>
                                </label>
                            </div>

                            {/* Billing warning for memberships */}
                            {isMembership && billingChanges && (
                                <div className={`border px-4 py-3 flex gap-3 ${confirmBilling ? "border-terra-400 bg-terra-400/10" : "border-amber-500/40 bg-amber-500/5"}`}>
                                    <AlertTriangle className="w-4 h-4 text-terra-400 shrink-0 mt-0.5" strokeWidth={2} />
                                    <div className="text-xs text-olive-500 leading-relaxed">
                                        <p className="font-bold text-olive-600 mb-1">
                                            {confirmBilling ? "Confirm the billing change" : "This changes Razorpay billing"}
                                        </p>
                                        <p>
                                            Saving creates a new Razorpay plan
                                            {charge ? ` at ${formatPaise(charge.totalPaise)} per cycle incl. GST` : ""}.
                                            New members are billed the new amount. Members already subscribed keep their current price until they change plans.
                                        </p>
                                        {confirmBilling && (
                                            <p className="mt-2 font-bold text-terra-400">Press Save again to confirm.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="px-8 pb-8 pt-2 flex flex-col-reverse sm:flex-row gap-3 sm:justify-between">
                            <button
                                type="button"
                                className={secondaryButton + " sm:w-auto"}
                                disabled={isSaving || !entry.override}
                                onClick={handleReset}
                                title={entry.override ? "Restore the built-in defaults for this plan" : "Already at defaults"}
                            >
                                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                                Reset to default
                            </button>
                            <div className="flex gap-3">
                                <button type="button" className={secondaryButton + " flex-1 sm:flex-none"} disabled={isSaving} onClick={onClose}>
                                    Cancel
                                </button>
                                <button type="button" className={primaryButton + " flex-1 sm:flex-none"} disabled={isSaving} onClick={handleSave}>
                                    {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {isSaving ? "Saving" : confirmBilling ? "Save & update billing" : "Save"}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
