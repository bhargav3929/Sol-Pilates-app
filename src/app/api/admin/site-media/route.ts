import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { adminAuth } from '@/lib/firebase/admin';
import {
    SITE_MEDIA_LIMITS,
    SITE_MEDIA_PAGES,
    SITE_MEDIA_SLOTS,
    getSiteMediaSlot,
} from '@/lib/site-media/registry';
import {
    clearSiteMediaOverride,
    deleteObjectQuietly,
    getSiteMediaRecords,
    getStorageBucket,
    isOurObjectPath,
    publicUrlFor,
    setSiteMediaOverride,
} from '@/lib/site-media/store';

// ---------------------------------------------------------------------------
// /api/admin/site-media — website image & video editor (admin only)
//
// GET            → pages, slots, and the current override for each slot
// POST {sign}    → signed URL so the browser can upload straight to storage
//                  (Vercel caps request bodies well below a hero video)
// POST {commit}  → after the upload: verify the object, publish it, save the
//                  override, retire the previous file
// DELETE ?slotId → back to the built-in default
// ---------------------------------------------------------------------------

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

type AdminCheck =
    | { ok: true; uid: string; email: string | null }
    | { ok: false; error: string; code: string; status: number };

function errorResponse(error: string, code: string, status: number) {
    return NextResponse.json({ error, code }, { status });
}

async function verifyAdmin(req: NextRequest): Promise<AdminCheck> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return { ok: false, error: 'Must be logged in', code: 'unauthenticated', status: 401 };
    }
    try {
        const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
        if (!decoded.admin) {
            return { ok: false, error: 'Admin access required', code: 'permission-denied', status: 403 };
        }
        return { ok: true, uid: decoded.uid, email: decoded.email ?? null };
    } catch {
        return { ok: false, error: 'Invalid or expired session', code: 'unauthenticated', status: 401 };
    }
}

function extensionFor(contentType: string, originalName: string): string {
    const byType: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
        'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    };
    if (byType[contentType]) return byType[contentType];
    const fromName = originalName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
    return fromName && fromName.length <= 5 ? fromName : 'bin';
}

function validateFile(slotKind: 'image' | 'video', contentType: string, size: number): string | null {
    const allowed: readonly string[] = slotKind === 'video' ? SITE_MEDIA_LIMITS.videoTypes : SITE_MEDIA_LIMITS.imageTypes;
    if (!allowed.includes(contentType)) {
        return slotKind === 'video'
            ? 'Please upload an MP4, WebM or MOV video.'
            : 'Please upload a JPG, PNG, WebP, GIF or AVIF image.';
    }
    const max = slotKind === 'video' ? SITE_MEDIA_LIMITS.videoBytes : SITE_MEDIA_LIMITS.imageBytes;
    if (!Number.isFinite(size) || size <= 0) return 'The file looks empty.';
    if (size > max) return `That file is too large. Maximum is ${Math.round(max / 1024 / 1024)}MB.`;
    return null;
}

async function buildResponse() {
    const records = await getSiteMediaRecords();
    return {
        pages: SITE_MEDIA_PAGES,
        slots: SITE_MEDIA_SLOTS.map((slot) => ({ ...slot, override: records[slot.id] ?? null })),
        limits: SITE_MEDIA_LIMITS,
    };
}

function revalidatePublic() {
    try {
        revalidatePath('/api/site-media');
    } catch {
        // Not fatal: the cache expires within a minute anyway.
    }
}

export async function GET(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);
        return NextResponse.json(await buildResponse());
    } catch (error) {
        console.error('[admin/site-media] GET failed', error);
        return errorResponse('Failed to load website media', 'internal', 500);
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return errorResponse('Invalid request body', 'invalid-argument', 400);
        }

        const slotId = typeof body.slotId === 'string' ? body.slotId : '';
        const slot = getSiteMediaSlot(slotId);
        if (!slot) return errorResponse('Unknown image slot', 'invalid-argument', 400);

        if (body.action === 'sign') {
            const contentType = typeof body.contentType === 'string' ? body.contentType.toLowerCase() : '';
            const size = typeof body.size === 'number' ? body.size : Number.NaN;
            const originalName = typeof body.originalName === 'string' ? body.originalName.slice(0, 200) : '';
            const problem = validateFile(slot.kind, contentType, size);
            if (problem) return errorResponse(problem, 'invalid-argument', 400);

            const objectPath = `site-media/${slot.id}/${Date.now()}.${extensionFor(contentType, originalName)}`;
            const [uploadUrl] = await getStorageBucket().file(objectPath).getSignedUrl({
                version: 'v4',
                action: 'write',
                expires: Date.now() + SIGNED_URL_TTL_MS,
                contentType,
            });
            return NextResponse.json({ uploadUrl, objectPath, contentType });
        }

        if (body.action === 'commit') {
            const objectPath = typeof body.objectPath === 'string' ? body.objectPath : '';
            const originalName = typeof body.originalName === 'string' ? body.originalName.slice(0, 200) : '';
            if (!isOurObjectPath(objectPath) || !objectPath.startsWith(`site-media/${slot.id}/`)) {
                return errorResponse('Upload path does not match this slot', 'invalid-argument', 400);
            }

            const file = getStorageBucket().file(objectPath);
            const [exists] = await file.exists();
            if (!exists) return errorResponse('The upload did not complete. Please try again.', 'not-found', 404);

            const [meta] = await file.getMetadata();
            const contentType = String(meta.contentType ?? '').toLowerCase();
            const size = Number(meta.size ?? 0);
            const problem = validateFile(slot.kind, contentType, size);
            if (problem) {
                await deleteObjectQuietly(objectPath);
                return errorResponse(problem, 'invalid-argument', 400);
            }

            // Long cache on the object itself: each upload gets a fresh file name,
            // so the website never serves a stale copy under the same URL.
            await file.setMetadata({ cacheControl: 'public, max-age=31536000, immutable' });
            await file.makePublic();

            const previous = (await getSiteMediaRecords())[slot.id];
            await setSiteMediaOverride(slot.id, {
                url: publicUrlFor(objectPath),
                path: objectPath,
                contentType,
                size,
                originalName,
                updatedBy: auth.uid,
                updatedByEmail: auth.email,
            });
            if (previous?.path && previous.path !== objectPath) await deleteObjectQuietly(previous.path);
            revalidatePublic();

            const response = await buildResponse();
            return NextResponse.json({ success: true, slot: response.slots.find((s) => s.id === slot.id) });
        }

        return errorResponse('action must be "sign" or "commit"', 'invalid-argument', 400);
    } catch (error) {
        console.error('[admin/site-media] POST failed', error);
        return errorResponse('Upload failed. Please try again.', 'internal', 500);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const auth = await verifyAdmin(req);
        if (!auth.ok) return errorResponse(auth.error, auth.code, auth.status);

        const slotId = req.nextUrl.searchParams.get('slotId') ?? '';
        const slot = getSiteMediaSlot(slotId);
        if (!slot) return errorResponse('Unknown image slot', 'invalid-argument', 400);

        const previous = (await getSiteMediaRecords())[slot.id];
        await clearSiteMediaOverride(slot.id);
        if (previous?.path) await deleteObjectQuietly(previous.path);
        revalidatePublic();

        const response = await buildResponse();
        return NextResponse.json({ success: true, slot: response.slots.find((s) => s.id === slot.id) });
    } catch (error) {
        console.error('[admin/site-media] DELETE failed', error);
        return errorResponse('Failed to reset image', 'internal', 500);
    }
}
