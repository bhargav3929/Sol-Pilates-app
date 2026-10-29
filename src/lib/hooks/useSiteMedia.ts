"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SiteMediaOverrides } from "@/lib/site-media/registry";

/**
 * Gives public pages the admin-uploaded replacement for an image or video
 * slot, falling back to the compiled-in default until the overrides arrive
 * (and forever if the request fails). One fetch per page load, shared by
 * every component on the page.
 */

type Listener = () => void;

let overrides: SiteMediaOverrides = {};
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit() {
    for (const l of listeners) l();
}

function load(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = fetch("/api/site-media", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : { overrides: {} }))
        .then((data: { overrides?: SiteMediaOverrides }) => {
            overrides = data.overrides && typeof data.overrides === "object" ? data.overrides : {};
        })
        .catch(() => {
            overrides = {};
        })
        .finally(() => {
            loaded = true;
            emit();
        });
    return inFlight;
}

function subscribe(listener: Listener) {
    listeners.add(listener);
    if (!loaded && typeof window !== "undefined") void load();
    return () => {
        listeners.delete(listener);
    };
}

const getSnapshot = () => overrides;
const serverSnapshot: SiteMediaOverrides = {};
const getServerSnapshot = () => serverSnapshot;

export function useSiteMedia() {
    const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const src = useCallback(
        (slotId: string, fallback: string): string => current[slotId] ?? fallback,
        [current],
    );

    return { src, overrides: current, loaded };
}
