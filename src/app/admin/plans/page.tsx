"use client"

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Eye, EyeOff, Pencil, RefreshCw, Sparkles, CheckCircle2, AlertCircle, History } from "lucide-react"
import { toast } from "sonner"
import {
    callAdminGetPlans,
    callAdminUpdatePlan,
    type AdminPlanEntry,
    type AdminPlanHistoryEntry,
    type AdminPlansResponse,
} from "@fitconnect/shared/firebase/firestore"
import { applyGstToRupees, formatPaise } from "@fitconnect/shared/utils/gst"
import { PlanEditDialog } from "@/components/admin/PlanEditDialog"

function formatRupees(rupees: number): string {
    if (rupees === 0) return "Free"
    return `₹${rupees.toLocaleString("en-IN")}`
}

function validityLabel(days: number): string {
    if (days % 30 === 0) return days === 30 ? "1 month" : `${days / 30} months`
    return `${days} days`
}

function formatWhen(iso: string | null): string {
    if (!iso) return "—"
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

const FIELD_LABELS: Record<string, string> = {
    name: "Name",
    price: "Price",
    foundingPrice: "Founding price",
    credits: "Credits",
    durationDays: "Validity",
    weeklyClassLimit: "Per week",
    guestPasses: "Guest passes",
    tagline: "Tagline",
    features: "Features",
    recommended: "Popular badge",
    hidden: "Visibility",
}

function describeValue(field: string, value: unknown): string {
    if (value === null || value === undefined) return field === "credits" ? "unlimited" : "none"
    if (field === "price" || field === "foundingPrice") return formatRupees(Number(value))
    if (field === "durationDays") return validityLabel(Number(value))
    if (field === "hidden") return value ? "hidden" : "visible"
    if (field === "recommended") return value ? "on" : "off"
    if (Array.isArray(value)) return `${value.length} lines`
    const s = String(value)
    return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

function PlanRow({
    entry,
    onEdit,
    onToggleHidden,
    busy,
}: {
    entry: AdminPlanEntry
    onEdit: () => void
    onToggleHidden: () => void
    busy: boolean
}) {
    const { plan, override, razorpay } = entry
    const charge = applyGstToRupees(plan.price)
    const isMembership = plan.category === "membership"

    return (
        <motion.article
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-peach-200 border p-6 ${plan.hidden ? "border-peach-400 opacity-70" : override ? "border-terra-400/40" : "border-peach-400"}`}
        >
            <div className="flex flex-col lg:flex-row lg:items-start gap-5">
                {/* Identity + price */}
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="font-black text-olive-600 text-lg leading-tight">{plan.name}</h3>
                        {plan.recommended && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-terra-400 text-peach-50 app-badge-text">
                                <Sparkles className="w-3 h-3" strokeWidth={2} /> POPULAR
                            </span>
                        )}
                        {override && (
                            <span className="px-2 py-0.5 border border-terra-400/50 text-terra-400 app-badge-text">EDITED</span>
                        )}
                        {plan.hidden && (
                            <span className="px-2 py-0.5 bg-olive-400 text-peach-50 app-badge-text">HIDDEN</span>
                        )}
                    </div>

                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-3xl font-bold text-olive-600 tracking-tight">{formatRupees(plan.price)}</span>
                        {plan.price > 0 && (
                            <span className="text-olive-300 text-xs">
                                + GST = <span className="font-bold text-olive-500">{formatPaise(charge.totalPaise)}</span>
                            </span>
                        )}
                        {plan.foundingPrice ? (
                            <span className="text-xs text-terra-400 font-bold ml-2">Founding {formatRupees(plan.foundingPrice)}</span>
                        ) : null}
                    </div>

                    <p className="text-olive-400 text-xs mt-2">
                        {plan.credits === null ? "Unlimited classes" : `${plan.credits} credit${plan.credits === 1 ? "" : "s"}`}
                        {" · "}{validityLabel(plan.durationDays)}
                        {" · "}{plan.weeklyClassLimit}/week
                        {plan.guestPasses > 0 ? ` · ${plan.guestPasses} guest pass${plan.guestPasses === 1 ? "" : "es"}` : ""}
                    </p>
                    {plan.tagline && (
                        <p className="text-olive-300 text-sm mt-2 leading-relaxed max-w-xl">{plan.tagline}</p>
                    )}
                </div>

                {/* Billing status */}
                <div className="lg:w-56 shrink-0">
                    {isMembership ? (
                        razorpay ? (
                            <div className={`border px-3 py-2.5 ${razorpay.inSync ? "border-peach-400" : "border-amber-500/50 bg-amber-500/5"}`}>
                                <div className="flex items-center gap-1.5 mb-1">
                                    {razorpay.inSync ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-olive-500" strokeWidth={2} />
                                    ) : (
                                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" strokeWidth={2} />
                                    )}
                                    <span className="app-badge-text text-olive-500">
                                        {razorpay.inSync ? "RAZORPAY IN SYNC" : "RAZORPAY OUT OF SYNC"}
                                    </span>
                                </div>
                                <p className="text-xs text-olive-400">
                                    Bills {razorpay.amountPaise !== null ? formatPaise(razorpay.amountPaise) : "—"} / cycle
                                </p>
                                {razorpay.foundingAmountPaise !== null && (
                                    <p className="text-xs text-olive-400">Founding {formatPaise(razorpay.foundingAmountPaise)}</p>
                                )}
                                <p className="text-[10px] text-olive-300 font-mono mt-1 truncate" title={razorpay.razorpayPlanId ?? undefined}>
                                    {razorpay.razorpayPlanId ?? "no plan yet"}
                                </p>
                            </div>
                        ) : null
                    ) : (
                        <div className="border border-peach-400 px-3 py-2.5">
                            <span className="app-badge-text text-olive-500">ONE-TIME PAYMENT</span>
                            <p className="text-xs text-olive-400 mt-1">Charged at checkout. Price changes apply instantly.</p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex lg:flex-col gap-2 shrink-0">
                    <button
                        onClick={onEdit}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-terra-400 text-peach-50 text-xs font-bold tracking-wider hover:bg-terra-300 transition-all disabled:opacity-50"
                    >
                        <Pencil className="w-3.5 h-3.5" strokeWidth={2} /> EDIT
                    </button>
                    <button
                        onClick={onToggleHidden}
                        disabled={busy}
                        title={plan.hidden ? "Show on website and app" : "Hide from website and app"}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-olive-400/30 text-olive-400 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all disabled:opacity-50"
                    >
                        {plan.hidden ? <Eye className="w-3.5 h-3.5" strokeWidth={2} /> : <EyeOff className="w-3.5 h-3.5" strokeWidth={2} />}
                        {plan.hidden ? "SHOW" : "HIDE"}
                    </button>
                </div>
            </div>
        </motion.article>
    )
}

export default function AdminPlansPage() {
    const [data, setData] = useState<AdminPlansResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [editing, setEditing] = useState<AdminPlanEntry | null>(null)
    const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        let cancelled = false
        callAdminGetPlans()
            .then((result) => {
                if (!cancelled) setData(result)
            })
            .catch((err: unknown) => {
                if (cancelled) return
                console.error("[admin/plans] failed to load", err)
                setLoadError(err instanceof Error ? err.message : "Couldn't load plans")
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [reloadKey])

    const refresh = () => {
        setLoading(true)
        setLoadError(null)
        setReloadKey((k) => k + 1)
    }

    const replaceEntry = useCallback((updated: AdminPlanEntry) => {
        setData((prev) => prev
            ? { ...prev, plans: prev.plans.map((p) => (p.plan.id === updated.plan.id ? updated : p)) }
            : prev)
        // History changed server-side; refetch quietly.
        callAdminGetPlans().then(setData).catch(() => {/* keep optimistic state */})
    }, [])

    const toggleHidden = async (entry: AdminPlanEntry) => {
        const p = entry.plan
        setBusyPlanId(p.id)
        try {
            const result = await callAdminUpdatePlan(p.id, {
                name: p.name,
                price: p.price,
                foundingPrice: p.foundingPrice ?? null,
                credits: p.credits,
                durationDays: p.durationDays,
                weeklyClassLimit: p.weeklyClassLimit,
                guestPasses: p.guestPasses,
                tagline: p.tagline ?? "",
                features: p.features,
                recommended: !!p.recommended,
                hidden: !p.hidden,
            })
            replaceEntry(result.plan)
            toast.success(p.hidden ? `${p.name} is visible again` : `${p.name} hidden from the website and app`)
        } catch (err) {
            toast.error("Could not update plan", { description: err instanceof Error ? err.message : undefined })
        } finally {
            setBusyPlanId(null)
        }
    }

    const memberships = data?.plans.filter((p) => p.plan.category === "membership") ?? []
    const classPacks = data?.plans.filter((p) => p.plan.category === "class_pack") ?? []
    const editedCount = data?.plans.filter((p) => p.override).length ?? 0
    const outOfSync = data?.plans.filter((p) => p.razorpay && !p.razorpay.inSync).length ?? 0

    return (
        <div>
            {/* Page Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="app-page-title">Plans &amp; Pricing</h1>
                    <p className="app-page-subtitle mt-1">
                        {loading
                            ? "Loading the catalog"
                            : editedCount > 0
                                ? `${editedCount} plan${editedCount === 1 ? "" : "s"} customised · changes are live on the website and app`
                                : "Everything at defaults · changes go live on the website and app instantly"}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {data && (
                        <span
                            className={`px-3 py-1.5 app-badge-text border ${
                                data.razorpayMode === "live"
                                    ? "border-olive-400/40 text-olive-500"
                                    : data.razorpayMode === "test"
                                        ? "border-amber-500/50 text-amber-700"
                                        : "border-red-400/50 text-red-600"
                            }`}
                            title="Which Razorpay account this server bills through"
                        >
                            RAZORPAY {data.razorpayMode.toUpperCase()}
                        </span>
                    )}
                    <button
                        onClick={refresh}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-4 py-2 border border-peach-400 text-olive-400 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
                        REFRESH
                    </button>
                </div>
            </div>

            {outOfSync > 0 && !loading && (
                <div className="mb-6 border border-amber-500/50 bg-amber-500/5 px-4 py-3 text-sm text-olive-500 flex gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
                    <p>
                        {outOfSync} membership{outOfSync === 1 ? " is" : "s are"} billing a different amount in Razorpay than the price shown here.
                        Open the plan and save it to create a matching Razorpay plan.
                    </p>
                </div>
            )}

            {loading ? (
                <div className="space-y-4" aria-busy="true" aria-label="Loading plans">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="bg-peach-200 border border-peach-400 p-6 animate-pulse">
                            <div className="h-5 w-48 bg-peach-400/60 mb-3" />
                            <div className="h-8 w-32 bg-peach-400/40 mb-2" />
                            <div className="h-3 w-72 bg-peach-400/40" />
                        </div>
                    ))}
                </div>
            ) : loadError ? (
                <div className="text-center py-20 border border-red-300 bg-red-50/40">
                    <div className="text-red-700 font-bold text-sm">{loadError}</div>
                </div>
            ) : (
                <div className="space-y-12">
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-xs font-black uppercase tracking-[0.15em] text-olive-500">Memberships</h2>
                            <div className="flex-1 h-px bg-peach-400/50" />
                            <span className="text-xs text-olive-300">{memberships.length} plans · recurring via Razorpay</span>
                        </div>
                        <div className="space-y-4">
                            {memberships.map((entry) => (
                                <PlanRow
                                    key={entry.plan.id}
                                    entry={entry}
                                    busy={busyPlanId === entry.plan.id}
                                    onEdit={() => setEditing(entry)}
                                    onToggleHidden={() => toggleHidden(entry)}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-xs font-black uppercase tracking-[0.15em] text-olive-500">Class Packs &amp; Intro</h2>
                            <div className="flex-1 h-px bg-peach-400/50" />
                            <span className="text-xs text-olive-300">{classPacks.length} plans · one-time payment</span>
                        </div>
                        <div className="space-y-4">
                            {classPacks.map((entry) => (
                                <PlanRow
                                    key={entry.plan.id}
                                    entry={entry}
                                    busy={busyPlanId === entry.plan.id}
                                    onEdit={() => setEditing(entry)}
                                    onToggleHidden={() => toggleHidden(entry)}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <h2 className="text-xs font-black uppercase tracking-[0.15em] text-olive-500 inline-flex items-center gap-2">
                                <History className="w-3.5 h-3.5" strokeWidth={2} /> Recent changes
                            </h2>
                            <div className="flex-1 h-px bg-peach-400/50" />
                        </div>
                        {data && data.history.length > 0 ? (
                            <ul className="border border-peach-400 divide-y divide-peach-400/60 bg-peach-200">
                                {data.history.map((h: AdminPlanHistoryEntry) => {
                                    const planName = data.plans.find((p) => p.plan.id === h.planId)?.plan.name ?? h.planId
                                    const fields = Object.keys(h.changes)
                                    return (
                                        <li key={h.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 text-sm">
                                            <span className="text-olive-300 text-xs whitespace-nowrap sm:w-32">{formatWhen(h.createdAt)}</span>
                                            <span className="font-bold text-olive-600 sm:w-44 truncate">{planName}</span>
                                            <span className="text-olive-400 text-xs flex-1">
                                                {h.action === "reset"
                                                    ? "Reset to defaults"
                                                    : fields.map((f) => `${FIELD_LABELS[f] ?? f}: ${describeValue(f, h.changes[f].from)} → ${describeValue(f, h.changes[f].to)}`).join(" · ")}
                                                {h.razorpayPlanIds && Object.keys(h.razorpayPlanIds).length > 0 && (
                                                    <span className="text-terra-400"> · new Razorpay plan</span>
                                                )}
                                            </span>
                                            <span className="text-olive-300 text-xs truncate sm:max-w-[12rem]">{h.adminEmail ?? ""}</span>
                                        </li>
                                    )
                                })}
                            </ul>
                        ) : (
                            <p className="text-olive-300 text-sm border border-dashed border-peach-400 px-5 py-6">
                                No changes yet. Edits made here are logged with who made them and what changed.
                            </p>
                        )}
                    </section>
                </div>
            )}

            {editing && (
                <PlanEditDialog
                    key={editing.plan.id}
                    entry={editing}
                    onClose={() => setEditing(null)}
                    onSaved={replaceEntry}
                />
            )}
        </div>
    )
}
