import { FieldValue } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { adminDb } from '@/lib/firebase/admin';
import { SITE_MEDIA_SLOT_IDS, type SiteMediaOverrides } from './registry';

/**
 * Server-side storage for admin-uploaded website media.
 *
 * Overrides live in `settings/siteMedia` keyed by slot id. Files live in the
 * project's storage bucket under `site-media/<slot>/<timestamp>.<ext>` and are
 * made public, so the website can render them straight from the CDN URL.
 */

export const SITE_MEDIA_BUCKET = 'sol-pilates-studio-storage';
const SITE_MEDIA_DOC = 'siteMedia';
const SITE_MEDIA_PREFIX = 'site-media/';

export interface SiteMediaOverrideRecord {
    url: string;
    path: string;
    contentType: string;
    size: number;
    originalName: string;
    updatedAt: string | null;
    updatedBy: string;
    updatedByEmail: string | null;
}

export function getStorageBucket() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
    const cleaned = raw.replace(/\\\n/g, '\\n');
    const creds = JSON.parse(cleaned);
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    return new Storage({ credentials: creds, projectId: creds.project_id }).bucket(SITE_MEDIA_BUCKET);
}

export function publicUrlFor(path: string): string {
    return `https://storage.googleapis.com/${SITE_MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function isOurObjectPath(path: string): boolean {
    return path.startsWith(SITE_MEDIA_PREFIX) && !path.includes('..');
}

function docRef() {
    return adminDb.collection('settings').doc(SITE_MEDIA_DOC);
}

function toIso(value: unknown): string | null {
    if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return typeof value === 'string' ? value : null;
}

export async function getSiteMediaRecords(): Promise<Record<string, SiteMediaOverrideRecord>> {
    try {
        const snap = await docRef().get();
        const raw = (snap.exists ? snap.data()?.overrides : null) as Record<string, Record<string, unknown>> | null | undefined;
        if (!raw) return {};
        const out: Record<string, SiteMediaOverrideRecord> = {};
        for (const [slotId, rec] of Object.entries(raw)) {
            if (!SITE_MEDIA_SLOT_IDS.has(slotId) || !rec || typeof rec.url !== 'string') continue;
            out[slotId] = {
                url: rec.url,
                path: typeof rec.path === 'string' ? rec.path : '',
                contentType: typeof rec.contentType === 'string' ? rec.contentType : '',
                size: typeof rec.size === 'number' ? rec.size : 0,
                originalName: typeof rec.originalName === 'string' ? rec.originalName : '',
                updatedAt: toIso(rec.updatedAt),
                updatedBy: typeof rec.updatedBy === 'string' ? rec.updatedBy : '',
                updatedByEmail: typeof rec.updatedByEmail === 'string' ? rec.updatedByEmail : null,
            };
        }
        return out;
    } catch (error) {
        console.error('[site-media] failed to read overrides; using defaults', error);
        return {};
    }
}

/** Slot id → URL, the shape the website consumes. */
export async function getSiteMediaOverrides(): Promise<SiteMediaOverrides> {
    const records = await getSiteMediaRecords();
    return Object.fromEntries(Object.entries(records).map(([id, r]) => [id, r.url]));
}

export async function setSiteMediaOverride(
    slotId: string,
    record: Omit<SiteMediaOverrideRecord, 'updatedAt'>,
): Promise<void> {
    await docRef().set(
        {
            overrides: { [slotId]: { ...record, updatedAt: FieldValue.serverTimestamp() } },
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

export async function clearSiteMediaOverride(slotId: string): Promise<void> {
    await docRef().set(
        {
            overrides: { [slotId]: FieldValue.delete() },
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

/** Best-effort delete of a previously uploaded object. Never throws. */
export async function deleteObjectQuietly(path: string): Promise<void> {
    if (!isOurObjectPath(path)) return;
    try {
        await getStorageBucket().file(path).delete({ ignoreNotFound: true });
    } catch (error) {
        console.warn('[site-media] could not delete old object', path, error);
    }
}
