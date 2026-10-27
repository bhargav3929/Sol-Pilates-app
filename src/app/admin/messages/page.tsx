"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Inbox, Mail, Phone, Trash2, Reply, CheckCheck, RotateCcw } from "lucide-react";
import {
  CONTACT_SUBJECT_LABELS,
  type ContactMessage,
  type ContactMessageStatus,
  type ContactSubject,
} from "@fitconnect/shared/types/contact";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { apiFetch } from "@fitconnect/shared/firebase/firestore";

const PAGE_SIZE = 10;
const API = "/api/admin/messages";

interface MessagesResponse {
  items: ContactMessage[];
  total: number;
  unreadTotal: number;
}

type Filter = "all" | ContactMessageStatus;
const FILTERS: Filter[] = ["all", "unread", "read"];

function subjectLabel(subject: string): string {
  return CONTACT_SUBJECT_LABELS[subject as ContactSubject] ?? "General Question";
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function replyHref(item: ContactMessage): string {
  const subject = encodeURIComponent(`Re: ${subjectLabel(item.subject)} — Sol Pilates Studio`);
  const body = encodeURIComponent(`Hi ${item.name},\n\n\n\n—\nYou wrote:\n${item.message}`);
  return `mailto:${item.email}?subject=${subject}&body=${body}`;
}

function MessagesPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");

  const [items, setItems] = useState<ContactMessage[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [requestedPage, setRequestedPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    apiFetch<MessagesResponse>(`${API}?status=${filter}&page=${requestedPage}&pageSize=${PAGE_SIZE}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotalItems(result.total);
        setUnreadTotal(result.unreadTotal);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[admin/messages] failed to load", err);
        setLoadError("Couldn't load messages. Refresh to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestedPage, filter, reloadKey]);

  const setStatus = async (id: string, status: ContactMessageStatus) => {
    const previous = items.find((m) => m.id === id)?.status;
    if (!previous || previous === status) return;
    // Optimistic update; refetch on failure so the list reflects the server.
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
    setUnreadTotal((n) => Math.max(0, n + (status === "unread" ? 1 : -1)));
    try {
      await apiFetch(API, { method: "PATCH", body: { id, status } });
    } catch (err) {
      console.error("[admin/messages] status update failed", err);
      setReloadKey((k) => k + 1);
    }
  };

  const removeMessage = async (id: string) => {
    const target = items.find((m) => m.id === id);
    if (!target) return;
    setItems((prev) => prev.filter((m) => m.id !== id));
    setTotalItems((n) => Math.max(0, n - 1));
    if (target.status === "unread") setUnreadTotal((n) => Math.max(0, n - 1));
    try {
      await apiFetch(`${API}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      console.error("[admin/messages] delete failed", err);
      setReloadKey((k) => k + 1);
    }
  };

  const selectFilter = (next: Filter) => {
    if (next === filter) return;
    setLoading(true);
    setLoadError(null);
    setFilter(next);
    setRequestedPage(1);
  };

  const goToPage = (next: number) => {
    if (next === requestedPage) return;
    setLoading(true);
    setLoadError(null);
    setRequestedPage(next);
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="app-page-title">Messages</h1>
          <p className="app-page-subtitle mt-1">
            {unreadTotal > 0
              ? `${unreadTotal} waiting for a reply`
              : "All caught up — contact form submissions from the website"}
          </p>
        </div>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => selectFilter(f)}
              className={`px-4 py-2 text-xs font-bold tracking-wider uppercase transition-all border ${
                filter === f
                  ? "bg-terra-400 text-peach-50 border-terra-400"
                  : "bg-transparent text-olive-400 border-peach-400 hover:border-terra-400 hover:text-terra-400"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading messages">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-peach-200 border border-peach-400 p-6 animate-pulse">
              <div className="h-4 w-40 bg-peach-400/60 mb-3" />
              <div className="h-3 w-full bg-peach-400/40 mb-2" />
              <div className="h-3 w-3/4 bg-peach-400/40" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-20 border border-red-300 bg-red-50/40">
          <div className="text-red-700 font-bold text-sm">{loadError}</div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-peach-400">
          <Inbox className="w-12 h-12 text-peach-400 mx-auto mb-4" strokeWidth={1.5} />
          <div className="text-olive-600 font-bold">
            {filter === "unread" ? "Nothing waiting on you" : "No messages yet"}
          </div>
          <p className="text-olive-300 text-sm mt-2 max-w-sm mx-auto">
            {filter === "unread"
              ? "Every contact form message has been read. New ones will appear here the moment they arrive."
              : "When someone fills in the form on the Contact page, their message lands here and a copy is emailed to the studio inbox."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => {
            const unread = item.status === "unread";
            const highlighted = item.id === highlightId;
            return (
              <motion.article
                key={item.id}
                id={`message-${item.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className={`bg-peach-200 border p-6 ${
                  highlighted
                    ? "border-terra-400 shadow-[0_0_0_2px_var(--color-terra-400,#C0714E)]"
                    : unread
                      ? "border-terra-400/40"
                      : "border-peach-400"
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <span className={`text-sm ${unread ? "font-black text-olive-600" : "font-bold text-olive-500"}`}>
                        {item.name}
                      </span>
                      {unread && (
                        <span className="px-2 py-0.5 bg-terra-400 text-peach-50 app-badge-text">NEW</span>
                      )}
                      <span className="px-2 py-0.5 bg-peach-300 text-olive-400 app-badge-text border border-peach-400">
                        {subjectLabel(item.subject)}
                      </span>
                    </div>

                    <p className="text-olive-500 text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {item.message}
                    </p>

                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                      <a
                        href={`mailto:${item.email}`}
                        className="inline-flex items-center gap-2 text-terra-400 text-xs hover:underline"
                      >
                        <Mail className="w-3.5 h-3.5" strokeWidth={2} />
                        {item.email}
                      </a>
                      {item.phone && (
                        <a
                          href={`tel:${item.phone}`}
                          className="inline-flex items-center gap-2 text-terra-400 text-xs hover:underline"
                        >
                          <Phone className="w-3.5 h-3.5" strokeWidth={2} />
                          {item.phone}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-row lg:flex-col items-center lg:items-end gap-3 shrink-0">
                    <span className="text-olive-300 text-xs whitespace-nowrap">{formatDate(item.createdAt)}</span>
                    <div className="flex gap-2">
                      <a
                        href={replyHref(item)}
                        onClick={() => {
                          if (unread) void setStatus(item.id, "read");
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-terra-400 text-peach-50 text-xs font-bold tracking-wider hover:bg-terra-300 transition-all"
                      >
                        <Reply className="w-3.5 h-3.5" strokeWidth={2} />
                        REPLY
                      </a>
                      {unread ? (
                        <button
                          onClick={() => setStatus(item.id, "read")}
                          title="Mark as read"
                          className="inline-flex items-center gap-2 px-3 py-1.5 border border-olive-400/30 text-olive-400 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all"
                        >
                          <CheckCheck className="w-3.5 h-3.5" strokeWidth={2} />
                          <span className="hidden sm:inline">MARK READ</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setStatus(item.id, "unread")}
                          title="Mark as unread"
                          className="inline-flex items-center gap-2 px-3 py-1.5 border border-peach-400 text-olive-300 text-xs font-bold tracking-wider hover:border-terra-400 hover:text-terra-400 transition-all"
                        >
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                          <span className="hidden sm:inline">UNREAD</span>
                        </button>
                      )}
                      <button
                        onClick={() => removeMessage(item.id)}
                        title="Delete message"
                        aria-label={`Delete message from ${item.name}`}
                        className="p-1.5 border border-peach-400 text-olive-300 hover:border-red-400 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-4 h-4" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.article>
            );
          })}
          <PaginationControls
            page={page}
            totalItems={totalItems}
            pageSize={PAGE_SIZE}
            itemLabel="messages"
            onPageChange={goToPage}
          />
        </div>
      )}
    </div>
  );
}

export default function AdminMessagesPage() {
  // useSearchParams requires a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <MessagesPageContent />
    </Suspense>
  );
}
