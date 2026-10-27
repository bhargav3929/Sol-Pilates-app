import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { sendContactMessageAlert } from '@/lib/email/contact-message-alert';
import { CONTACT_SUBJECT_LABELS, type ContactSubject } from '@fitconnect/shared/types/contact';

// ---------------------------------------------------------------------------
// POST /api/contact — public contact form submission
//
// Stores the message in the `contactMessages` collection (admin SDK, so the
// collection stays closed to client writes) and emails the studio inbox.
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 30;
const MAX_MESSAGE_LENGTH = 4000;

// Simple per-IP throttle. Serverless instances do not share memory, so this
// is a soft limit against a single runaway client, not a hard guarantee.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const submissionLog = new Map<string, number[]>();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function errorResponse(error: string, code: string, status: number) {
    return NextResponse.json({ error, code }, { status });
}

function getClientIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (submissionLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
        submissionLog.set(ip, recent);
        return true;
    }
    recent.push(now);
    submissionLog.set(ip, recent);
    return false;
}

function cleanString(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function parseSubject(value: unknown): ContactSubject {
    if (typeof value === 'string' && value in CONTACT_SUBJECT_LABELS) {
        return value as ContactSubject;
    }
    return 'general';
}

export async function POST(req: NextRequest) {
    try {
        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return errorResponse('Invalid request body', 'invalid-argument', 400);
        }

        // Honeypot: real users never see or fill this field. Bots that do get a
        // quiet success so they do not learn to adapt.
        if (typeof body.website === 'string' && body.website.trim()) {
            return NextResponse.json({ ok: true });
        }

        const name = cleanString(body.name, MAX_NAME_LENGTH);
        const email = cleanString(body.email, MAX_EMAIL_LENGTH).toLowerCase();
        const phone = cleanString(body.phone, MAX_PHONE_LENGTH);
        const subject = parseSubject(body.subject);
        const message = cleanString(body.message, MAX_MESSAGE_LENGTH);

        if (!name) return errorResponse('Please tell us your name', 'invalid-argument', 400);
        if (!email || !EMAIL_PATTERN.test(email)) {
            return errorResponse('Please enter a valid email address', 'invalid-argument', 400);
        }
        if (!message) return errorResponse('Please write a message', 'invalid-argument', 400);

        const ip = getClientIp(req);
        if (isRateLimited(ip)) {
            return errorResponse('Too many messages sent. Please try again in a few minutes.', 'rate-limited', 429);
        }

        const docRef = await adminDb.collection('contactMessages').add({
            name,
            email,
            phone,
            subject,
            message,
            status: 'unread',
            source: 'web',
            createdAt: FieldValue.serverTimestamp(),
        });

        // The message is safely stored at this point. An email failure must not
        // turn into an error for the visitor.
        try {
            await sendContactMessageAlert({ id: docRef.id, name, email, phone, subject, message });
        } catch (err) {
            console.error('[contact] alert email failed for message', docRef.id, err);
        }

        return NextResponse.json({ ok: true, id: docRef.id });
    } catch (err) {
        console.error('[contact] failed to store message', err);
        return errorResponse('Something went wrong. Please try again or email us directly.', 'internal', 500);
    }
}
