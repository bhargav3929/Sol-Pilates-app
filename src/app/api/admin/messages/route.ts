import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import type { ContactMessageStatus } from '@fitconnect/shared/types/contact';

// ---------------------------------------------------------------------------
// /api/admin/messages — contact form inbox (admin only)
//
// Reads and writes go through the Admin SDK so the `contactMessages`
// collection never needs client-side Firestore access.
// ---------------------------------------------------------------------------

const COLLECTION = 'contactMessages';
// A contact inbox is small. Reading the newest batch and paging in memory
// keeps this index-free; raise if the studio ever outgrows it.
const FETCH_CAP = 500;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

type StatusFilter = 'all' | ContactMessageStatus;

function errorResponse(error: string, code: string, status: number) {
    return NextResponse.json({ error, code }, { status });
}

type AdminCheck =
    | { ok: true; uid: string }
    | { ok: false; error: string; code: string; status: number };

async function verifyAdmin(req: NextRequest): Promise<AdminCheck> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return { ok: false, error: 'Must be logged in', code: 'unauthenticated', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (!decoded.admin) {
            return { ok: false, error: 'Admin access required', code: 'permission-denied', status: 403 };
        }
        return { ok: true, uid: decoded.uid };
    } catch {
        return { ok: false, error: 'Invalid or expired session', code: 'unauthenticated', status: 401 };
    }
}

function parseStatusFilter(value: string | null): StatusFilter {
    return value === 'unread' || value === 'read' ? value : 'all';
}

function parseStatus(value: unknown): ContactMessageStatus | null {
    return value === 'unread' || value === 'read' ? value : null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
    const n = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(n, max);
}

function serializeCreatedAt(value: unknown): string | null {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    return null;
}

// GET — list messages, newest first, with optional status filter and paging
export async function GET(req: NextRequest) {
    try {
        const authResult = await verifyAdmin(req);
        if (!authResult.ok) {
            return errorResponse(authResult.error, authResult.code, authResult.status);
        }

        const params = req.nextUrl.searchParams;
        const status = parseStatusFilter(params.get('status'));
        const page = parsePositiveInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER);
        const pageSize = parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

        const snapshot = await adminDb
            .collection(COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(FETCH_CAP)
            .get();

        const all = snapshot.docs.map((d) => {
            const data = d.data();
            return {
                id: d.id,
                name: typeof data.name === 'string' ? data.name : '',
                email: typeof data.email === 'string' ? data.email : '',
                phone: typeof data.phone === 'string' ? data.phone : '',
                subject: typeof data.subject === 'string' ? data.subject : 'general',
                message: typeof data.message === 'string' ? data.message : '',
                status: data.status === 'read' ? 'read' : 'unread',
                source: 'web' as const,
                createdAt: serializeCreatedAt(data.createdAt),
            };
        });

        const unreadTotal = all.filter((m) => m.status === 'unread').length;
        const filtered = status === 'all' ? all : all.filter((m) => m.status === status);
        const start = (page - 1) * pageSize;
        const items = filtered.slice(start, start + pageSize);

        return NextResponse.json({ items, total: filtered.length, unreadTotal, page, pageSize });
    } catch (err) {
        console.error('[admin/messages] GET failed', err);
        return errorResponse('Failed to load messages', 'internal', 500);
    }
}

// PATCH — mark a message read or unread
export async function PATCH(req: NextRequest) {
    try {
        const authResult = await verifyAdmin(req);
        if (!authResult.ok) {
            return errorResponse(authResult.error, authResult.code, authResult.status);
        }

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return errorResponse('Invalid request body', 'invalid-argument', 400);
        }

        const id = typeof body.id === 'string' ? body.id.trim() : '';
        const status = parseStatus(body.status);
        if (!id) return errorResponse('id is required', 'invalid-argument', 400);
        if (!status) return errorResponse('status must be "read" or "unread"', 'invalid-argument', 400);

        const ref = adminDb.collection(COLLECTION).doc(id);
        const doc = await ref.get();
        if (!doc.exists) return errorResponse('Message not found', 'not-found', 404);

        await ref.update({ status, statusUpdatedAt: Timestamp.now(), statusUpdatedBy: authResult.uid });
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[admin/messages] PATCH failed', err);
        return errorResponse('Failed to update message', 'internal', 500);
    }
}

// DELETE — remove a message permanently (?id=...)
export async function DELETE(req: NextRequest) {
    try {
        const authResult = await verifyAdmin(req);
        if (!authResult.ok) {
            return errorResponse(authResult.error, authResult.code, authResult.status);
        }

        const id = req.nextUrl.searchParams.get('id')?.trim() || '';
        if (!id) return errorResponse('id is required', 'invalid-argument', 400);

        const ref = adminDb.collection(COLLECTION).doc(id);
        const doc = await ref.get();
        if (!doc.exists) return errorResponse('Message not found', 'not-found', 404);

        await ref.delete();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[admin/messages] DELETE failed', err);
        return errorResponse('Failed to delete message', 'internal', 500);
    }
}
