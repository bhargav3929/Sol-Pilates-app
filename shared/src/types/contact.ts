/**
 * Contact form submissions from the public /contact page.
 *
 * Written server-side by POST /api/contact (Firebase Admin SDK) and read by
 * admins on /admin/messages. Never client-writable.
 */

export type ContactSubject = 'booking' | 'membership' | 'private' | 'general';

export type ContactMessageStatus = 'unread' | 'read';

export const CONTACT_SUBJECT_LABELS: Record<ContactSubject, string> = {
    booking: 'Class Booking',
    membership: 'Membership Enquiry',
    private: 'Private Sessions',
    general: 'General Question',
};

export interface ContactMessage {
    id: string;
    name: string;
    email: string;
    phone: string;
    subject: ContactSubject;
    message: string;
    status: ContactMessageStatus;
    source: 'web';
    /** Firestore Timestamp on read; serverTimestamp() on write. */
    createdAt: unknown;
}
