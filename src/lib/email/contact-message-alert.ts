import { Resend } from 'resend';
import { CONTACT_SUBJECT_LABELS, type ContactSubject } from '@fitconnect/shared/types/contact';

/**
 * Emails the studio inbox when someone submits the public contact form.
 *
 * Sends through Resend. Configure with:
 *   RESEND_API_KEY          API key from resend.com
 *   RESEND_FROM             sender, e.g. "Sol Pilates Studio <bookings@solpilatesstudio.in>"
 *   CONTACT_NOTIFY_EMAIL    inbox that receives the alert (defaults to the studio Gmail)
 * If RESEND_API_KEY or RESEND_FROM is missing the alert is skipped and a
 * warning is logged. The submission is still stored in Firestore, so nothing
 * is lost when mail is unconfigured.
 */

const DEFAULT_NOTIFY_EMAIL = 'solpilatesstudio.in@gmail.com';

interface ContactAlertInput {
    id: string;
    name: string;
    email: string;
    phone: string;
    subject: ContactSubject;
    message: string;
}

function getMailer(): { resend: Resend; from: string; to: string } | null {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    if (!apiKey || !from) return null;
    const to = process.env.CONTACT_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
    return { resend: new Resend(apiKey), from, to };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getAdminUrl(id: string): string {
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.solpilatesstudio.in';
    return `${base.replace(/\/$/, '')}/admin/messages?highlight=${encodeURIComponent(id)}`;
}

export async function sendContactMessageAlert(input: ContactAlertInput): Promise<void> {
    const mailer = getMailer();
    if (!mailer) {
        console.warn('[contact-alert] RESEND_API_KEY / RESEND_FROM not set; skipping alert for message', input.id);
        return;
    }

    const topic = CONTACT_SUBJECT_LABELS[input.subject];
    const subject = `New contact message: ${topic} from ${input.name}`;

    const lines = [
        `${input.name} sent a message through the website contact form.`,
        '',
        `Topic: ${topic}`,
        `Email: ${input.email}`,
        input.phone ? `Phone: ${input.phone}` : '',
        '',
        'Message:',
        input.message,
        '',
        `Reply directly to this email, or open it in the admin panel: ${getAdminUrl(input.id)}`,
        '',
        'Sol Pilates Studio',
    ].filter((line) => line !== '');

    const text = lines.join('\n');
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${lines
        .map((line) => (line === '' ? '<br>' : `<p style="margin:0 0 6px;white-space:pre-wrap">${escapeHtml(line)}</p>`))
        .join('')}</div>`;

    const { data, error } = await mailer.resend.emails.send({
        from: mailer.from,
        to: mailer.to,
        replyTo: input.email,
        subject,
        text,
        html,
    });
    if (error) {
        throw new Error(`Resend rejected the email: ${error.message}`);
    }
    console.log('[contact-alert] sent', { messageId: input.id, to: mailer.to, emailId: data?.id });
}
