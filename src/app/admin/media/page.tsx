"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { ExternalLink, ImageIcon, Loader2, RefreshCw, RotateCcw, Upload, Video } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@fitconnect/shared/firebase/firestore"
import type { SiteMediaPage, SiteMediaPageId, SiteMediaSlot } from "@/lib/site-media/registry"

interface SlotOverride {
    url: string
    path: string
    contentType: string
    size: number
    originalName: string
    updatedAt: string | null
    updatedByEmail: string | null
}

type SlotWithOverride = SiteMediaSlot & { override: SlotOverride | null }

interface MediaResponse {
    pages: SiteMediaPage[]
    slots: SlotWithOverride[]
    limits: { imageBytes: number; videoBytes: number; imageTypes: readonly string[]; videoTypes: readonly string[] }
}

const API = "/api/admin/site-media"

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
}

function formatWhen(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

/** PUT the file straight to storage with progress, as the signed URL allows. */
function uploadToSignedUrl(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", url, true)
        xhr.setRequestHeader("Content-Type", contentType)
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage rejected the upload (${xhr.status})`)))
        xhr.onerror = () => reject(new Error("Network error during upload"))
        xhr.send(file)
    })
}

function Preview({ slot, src, muted }: { slot: SiteMediaSlot; src: string; muted?: boolean }) {
    if (slot.kind === "video") {
        return (
            <video
                key={src}
                src={src}
                muted
                loop
                playsInline
                autoPlay
                className={`w-full h-full object-cover ${muted ? "opacity-60" : ""}`}
            />
        )
    }
    // Plain <img>: admin previews come from arbitrary uploads and must not go through next/image's loader.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={slot.label} className={`w-full h-full ${slot.id === "brand.logo" ? "object-contain p-4" : "object-cover"} ${muted ? "opacity-60" : ""}`} />
}

function SlotRow({
    slot,
    limits,
    onChanged,
}: {
    slot: SlotWithOverride
    limits: MediaResponse["limits"]
    onChanged: (updated: SlotWithOverride) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [progress, setProgress] = useState<number | null>(null)
    const [busy, setBusy] = useState(false)
    const isVideo = slot.kind === "video"
    const currentSrc = slot.override?.url ?? slot.defaultSrc
    const accept = isVideo ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp,image/gif,image/avif"
    const maxBytes = isVideo ? limits.videoBytes : limits.imageBytes

    const handleFile = async (file: File) => {
        const allowed = isVideo ? limits.videoTypes : limits.imageTypes
        if (!allowed.includes(file.type)) {
            toast.error(isVideo ? "Please choose an MP4, WebM or MOV video." : "Please choose a JPG, PNG, WebP, GIF or AVIF image.")
            return
        }
        if (file.size > maxBytes) {
            toast.error(`That file is ${formatBytes(file.size)}. Maximum is ${formatBytes(maxBytes)}.`)
            return
        }
        setBusy(true)
        setProgress(0)
        try {
            const signed = await apiFetch<{ uploadUrl: string; objectPath: string; contentType: string }>(API, {
                method: "POST",
                body: { action: "sign", slotId: slot.id, contentType: file.type, size: file.size, originalName: file.name },
            })
            await uploadToSignedUrl(signed.uploadUrl, file, signed.contentType, setProgress)
            const result = await apiFetch<{ success: boolean; slot: SlotWithOverride }>(API, {
                method: "POST",
                body: { action: "commit", slotId: slot.id, objectPath: signed.objectPath, originalName: file.name },
            })
            onChanged(result.slot)
            toast.success(`${slot.label} updated`, { description: "Live on the website now." })
        } catch (err) {
            toast.error("Upload failed", { description: err instanceof Error ? err.message : undefined })
        } finally {
            setBusy(false)
            setProgress(null)
            if (inputRef.current) inputRef.current.value = ""
        }
    }

    const handleReset = async () => {
        setBusy(true)
        try {
            const result = await apiFetch<{ success: boolean; slot: SlotWithOverride }>(`${API}?slotId=${encodeURIComponent(slot.id)}`, { method: "DELETE" })
            onChanged(result.slot)
            toast.success(`${slot.label} back to the original`)
        } catch (err) {
            toast.error("Could not reset", { description: err instanceof Error ? err.message : undefined })
        } finally {
            setBusy(false)
        }
    }

    return (
        <motion.article
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-peach-200 border ${slot.override ? "border-terra-400/40" : "border-peach-400"}`}
        >
            <div className="flex flex-col md:flex-row">
                {/* Current */}
                <div className="relative md:w-72 shrink-0 aspect-[16/10] md:aspect-auto md:min-h-[11rem] bg-peach-300 overflow-hidden">
                    <Preview slot={slot} src={currentSrc} />
                    <span className={`absolute top-3 left-3 px-2 py-0.5 app-badge-text ${slot.override ? "bg-terra-400 text-peach-50" : "bg-olive-500/80 text-peach-50"}`}>
                        {slot.override ? "UPLOADED" : "ORIGINAL"}
                    </span>
                    {progress !== null && (
                        <div className="absolute inset-0 bg-warmDark-900/70 flex flex-col items-center justify-center gap-3 text-peach-50">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-xs font-bold tracking-wider">{progress < 100 ? `UPLOADING ${progress}%` : "SAVING…"}</span>
                            <div className="w-40 h-1 bg-peach-50/20">
                                <div className="h-full bg-terra-400 transition-all" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                    )}
                </div>

                {/* Details + actions */}
                <div className="flex-1 p-5 flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                {isVideo ? <Video className="w-4 h-4 text-terra-400" strokeWidth={2} /> : <ImageIcon className="w-4 h-4 text-terra-400" strokeWidth={2} />}
                                <h3 className="font-black text-olive-600 leading-tight">{slot.label}</h3>
                            </div>
                            <p className="text-olive-400 text-xs leading-relaxed">{slot.hint}</p>
                        </div>
                        <a
                            href={currentSrc}
                            target="_blank"
                            rel="noreferrer"
                            title="Open the current file in a new tab"
                            className="shrink-0 p-1.5 border border-peach-400 text-olive-300 hover:border-terra-400 hover:text-terra-400 transition-all"
                        >
                            <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
                        </a>
                    </div>

                    {slot.override ? (
                        <p className="text-[11px] text-olive-300">
                            {slot.override.originalName || "Uploaded file"}
                            {slot.override.size ? ` · ${formatBytes(slot.override.size)}` : ""}
                            {slot.override.updatedAt ? ` · ${formatWhen(slot.override.updatedAt)}` : ""}
                            {slot.override.updatedByEmail ? ` · ${slot.override.updatedByEmail}` : ""}
                        </p>
                    ) : (
                        <p className="text-[11px] text-olive-300">Showing the original that shipped with the website.</p>
                    )}

                    <div className="mt-auto flex flex-wrap gap-2">
                        <input
                            ref={inputRef}
                            type="file"
                            accept={accept}
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) void handleFile(f)
                            }}
                        />
                        <button
                            onClick={() => inputRef.current?.click()}
                            disabled={busy}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-terra-400 text-peach-50 text-xs font-bold tracking-wider hover:bg-terra-300 transition-all disabled:opacity-50"
                        >
                            <Upload className="w-3.5 h-3.5" strokeWidth={2} />
                            {slot.override ? "REPLACE" : "UPLOAD NEW"}
                        </button>
                        {slot.override && (
                            <button
                                onClick={handleReset}
                                disabled={busy}
                                className="inline-flex items-center gap-2 px-4 py-2 border border-olive-400/30 text-olive-400 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all disabled:opacity-50"
                            >
                                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                                USE ORIGINAL
                            </button>
                        )}
                        <span className="self-center text-[11px] text-olive-300 ml-1">
                            {isVideo ? "MP4 up to" : "JPG, PNG or WebP up to"} {formatBytes(maxBytes)}
                        </span>
                    </div>
                </div>
            </div>
        </motion.article>
    )
}

export default function AdminMediaPage() {
    const [data, setData] = useState<MediaResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [pageId, setPageId] = useState<SiteMediaPageId>("home")
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        let cancelled = false
        apiFetch<MediaResponse>(API)
            .then((result) => {
                if (!cancelled) setData(result)
            })
            .catch((err: unknown) => {
                if (cancelled) return
                console.error("[admin/media] failed to load", err)
                setLoadError(err instanceof Error ? err.message : "Couldn't load website images")
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

    const replaceSlot = (updated: SlotWithOverride) => {
        setData((prev) => prev ? { ...prev, slots: prev.slots.map((s) => (s.id === updated.id ? updated : s)) } : prev)
    }

    const page = data?.pages.find((p) => p.id === pageId) ?? null
    const slotsForPage = useMemo(() => data?.slots.filter((s) => s.page === pageId) ?? [], [data, pageId])
    const uploadedCount = data?.slots.filter((s) => s.override).length ?? 0
    const countFor = (id: SiteMediaPageId) => data?.slots.filter((s) => s.page === id && s.override).length ?? 0

    return (
        <div>
            {/* Page Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="app-page-title">Website Images</h1>
                    <p className="app-page-subtitle mt-1">
                        {loading
                            ? "Loading the website's images"
                            : uploadedCount > 0
                                ? `${uploadedCount} image${uploadedCount === 1 ? "" : "s"} replaced · uploads go live within a minute`
                                : "Pick a page, find the image, upload a replacement. It goes live within a minute."}
                    </p>
                </div>
                <button
                    onClick={refresh}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-peach-400 text-olive-400 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
                    REFRESH
                </button>
            </div>

            {/* Page tabs */}
            {data && (
                <div className="flex flex-wrap gap-2 mb-8 border-b border-peach-400/60 pb-4">
                    {data.pages.map((p) => {
                        const n = countFor(p.id)
                        return (
                            <button
                                key={p.id}
                                onClick={() => setPageId(p.id)}
                                className={`px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all border inline-flex items-center gap-2 ${
                                    pageId === p.id
                                        ? "bg-terra-400 text-peach-50 border-terra-400"
                                        : "bg-transparent text-olive-400 border-peach-400 hover:border-terra-400 hover:text-terra-400"
                                }`}
                            >
                                {p.label}
                                {n > 0 && (
                                    <span className={`px-1.5 py-0.5 text-[10px] ${pageId === p.id ? "bg-peach-50/20" : "bg-terra-400/15 text-terra-400"}`}>{n}</span>
                                )}
                            </button>
                        )
                    })}
                    {page && (
                        <a
                            href={page.path}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto inline-flex items-center gap-1.5 text-xs text-olive-400 hover:text-terra-400 self-center"
                        >
                            View page <ExternalLink className="w-3 h-3" strokeWidth={2} />
                        </a>
                    )}
                </div>
            )}

            {loading ? (
                <div className="space-y-4" aria-busy="true" aria-label="Loading website images">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="bg-peach-200 border border-peach-400 h-44 animate-pulse" />
                    ))}
                </div>
            ) : loadError ? (
                <div className="text-center py-20 border border-red-300 bg-red-50/40">
                    <div className="text-red-700 font-bold text-sm">{loadError}</div>
                </div>
            ) : page ? (
                <div className="space-y-12">
                    {page.sections.map((section) => {
                        const slots = slotsForPage.filter((s) => s.section === section.id)
                        if (!slots.length) return null
                        return (
                            <section key={section.id}>
                                <div className="flex items-baseline gap-3 mb-4">
                                    <h2 className="text-xs font-black uppercase tracking-[0.15em] text-olive-500 whitespace-nowrap">{section.label}</h2>
                                    <div className="flex-1 h-px bg-peach-400/50" />
                                    <span className="text-xs text-olive-300">{slots.length} {slots.length === 1 ? "item" : "items"}</span>
                                </div>
                                {section.description && (
                                    <p className="text-olive-300 text-sm mb-4 -mt-2">{section.description}</p>
                                )}
                                <div className="space-y-4">
                                    {slots.map((slot) => (
                                        <SlotRow key={slot.id} slot={slot} limits={data!.limits} onChanged={replaceSlot} />
                                    ))}
                                </div>
                            </section>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}
