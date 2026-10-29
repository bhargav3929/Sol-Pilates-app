/**
 * Every editable image and video on the public website, grouped by page and
 * section. Components render a slot's default unless an admin has uploaded a
 * replacement on /admin/media. Adding a new slot here is all it takes to make
 * a new image editable: give it an id, point it at the current file, and
 * render it through useSiteMedia().
 *
 * This file is imported by both server and client code; keep it free of
 * Node-only imports.
 */

export type SiteMediaKind = 'image' | 'video';

export interface SiteMediaSlot {
    id: string;
    page: SiteMediaPageId;
    section: string;
    label: string;
    kind: SiteMediaKind;
    defaultSrc: string;
    /** Where it appears, and what shape works best. Shown to admins. */
    hint: string;
}

export type SiteMediaPageId = 'home' | 'facilities' | 'brand';

export interface SiteMediaPage {
    id: SiteMediaPageId;
    label: string;
    path: string;
    sections: Array<{ id: string; label: string; description?: string }>;
}

export const SITE_MEDIA_PAGES: SiteMediaPage[] = [
    {
        id: 'home',
        label: 'Home',
        path: '/',
        sections: [
            { id: 'hero', label: 'Hero', description: 'Full-screen video at the top of the page, with a poster image shown while it loads.' },
            { id: 'why-sol', label: 'Why Sol', description: 'Three cards: The Method, The Space, The Result.' },
            { id: 'class-types', label: 'Class Types', description: 'One photo per class: Sol Flow, Sol Cardio, Sol Stretch.' },
            { id: 'tavaro', label: 'Inside Tavaro Resorts', description: 'Large resort photo plus two smaller shots.' },
            { id: 'instagram', label: 'Instagram strip', description: 'Six square thumbnails that scroll across the page.' },
        ],
    },
    {
        id: 'facilities',
        label: 'Facilities',
        path: '/facilities',
        sections: [
            { id: 'zones', label: 'Studio zones', description: 'One photo per zone, shown when the zone is selected.' },
        ],
    },
    {
        id: 'brand',
        label: 'Logo',
        path: '/',
        sections: [
            { id: 'logo', label: 'Site logo', description: 'Used in the header and footer on every page.' },
        ],
    },
];

export const SITE_MEDIA_SLOTS: SiteMediaSlot[] = [
    // ── Home · Hero ───────────────────────────────────────────────
    {
        id: 'home.hero.video',
        page: 'home', section: 'hero', label: 'Background video', kind: 'video',
        defaultSrc: '/videos/Background_option_1.mp4',
        hint: 'Plays muted on loop behind the headline. MP4, landscape, ideally under 20MB.',
    },
    {
        id: 'home.hero.poster',
        page: 'home', section: 'hero', label: 'Poster image', kind: 'image',
        defaultSrc: '/images/sol-hero-poster.jpeg',
        hint: 'Shown until the video starts, and on phones that block autoplay. Landscape.',
    },

    // ── Home · Why Sol ────────────────────────────────────────────
    { id: 'home.why-sol.method', page: 'home', section: 'why-sol', label: 'The Method', kind: 'image', defaultSrc: '/images/IMG_9731.jpeg', hint: 'Portrait card. Instructor demonstrating a move.' },
    { id: 'home.why-sol.space', page: 'home', section: 'why-sol', label: 'The Space', kind: 'image', defaultSrc: '/images/IMG_0992_.jpeg', hint: 'Portrait card. The studio or resort grounds.' },
    { id: 'home.why-sol.result', page: 'home', section: 'why-sol', label: 'The Result', kind: 'image', defaultSrc: '/images/IMG_9901.jpeg', hint: 'Portrait card. A client in everyday life.' },

    // ── Home · Class types ────────────────────────────────────────
    { id: 'home.class-types.sol-flow', page: 'home', section: 'class-types', label: 'Sol Flow', kind: 'image', defaultSrc: '/images/IMG_9836.jpeg', hint: 'Wide photo for the Sol Flow card.' },
    { id: 'home.class-types.sol-cardio', page: 'home', section: 'class-types', label: 'Sol Cardio', kind: 'image', defaultSrc: '/images/IMG_0003.jpeg', hint: 'Wide photo for the Sol Cardio card.' },
    { id: 'home.class-types.sol-stretch', page: 'home', section: 'class-types', label: 'Sol Stretch', kind: 'image', defaultSrc: '/images/IMG_9787_.jpeg', hint: 'Wide photo for the Sol Stretch card.' },

    // ── Home · Tavaro ─────────────────────────────────────────────
    { id: 'home.tavaro.hero', page: 'home', section: 'tavaro', label: 'Main resort photo', kind: 'image', defaultSrc: '/images/97.jpeg', hint: 'The large image. Landscape works best.' },
    { id: 'home.tavaro.grounds', page: 'home', section: 'tavaro', label: 'Grounds photo', kind: 'image', defaultSrc: '/images/Studio.jpeg', hint: 'Smaller image, left.' },
    { id: 'home.tavaro.studio', page: 'home', section: 'tavaro', label: 'Studio photo', kind: 'image', defaultSrc: '/images/Studio_in_construction.jpeg', hint: 'Smaller image, right.' },

    // ── Home · Instagram ──────────────────────────────────────────
    { id: 'home.instagram.1', page: 'home', section: 'instagram', label: 'Thumbnail 1', kind: 'image', defaultSrc: '/images/sol-pilates-mat-brown.jpeg', hint: 'Square.' },
    { id: 'home.instagram.2', page: 'home', section: 'instagram', label: 'Thumbnail 2', kind: 'image', defaultSrc: '/images/sol-pilates-mat-olive.jpeg', hint: 'Square.' },
    { id: 'home.instagram.3', page: 'home', section: 'instagram', label: 'Thumbnail 3', kind: 'image', defaultSrc: '/images/service-muscle-recovery.jpg', hint: 'Square.' },
    { id: 'home.instagram.4', page: 'home', section: 'instagram', label: 'Thumbnail 4', kind: 'image', defaultSrc: '/images/service-reset-restore.jpg', hint: 'Square.' },
    { id: 'home.instagram.5', page: 'home', section: 'instagram', label: 'Thumbnail 5', kind: 'image', defaultSrc: '/images/service-strength-sculpt.jpg', hint: 'Square.' },
    { id: 'home.instagram.6', page: 'home', section: 'instagram', label: 'Thumbnail 6', kind: 'image', defaultSrc: '/images/service-cardio-endurance.jpg', hint: 'Square.' },

    // ── Facilities · Zones ────────────────────────────────────────
    { id: 'facilities.zone.strength-sculpt', page: 'facilities', section: 'zones', label: 'Strength & Sculpt', kind: 'image', defaultSrc: '/images/service-strength-sculpt.jpg', hint: 'Landscape.' },
    { id: 'facilities.zone.cardio-endurance', page: 'facilities', section: 'zones', label: 'Cardio & Endurance', kind: 'image', defaultSrc: '/images/service-cardio-endurance.jpg', hint: 'Landscape.' },
    { id: 'facilities.zone.reset-restore', page: 'facilities', section: 'zones', label: 'Reset & Restore', kind: 'image', defaultSrc: '/images/service-reset-restore.jpg', hint: 'Landscape.' },
    { id: 'facilities.zone.muscle-recovery', page: 'facilities', section: 'zones', label: 'Muscle Recovery', kind: 'image', defaultSrc: '/images/service-muscle-recovery.jpg', hint: 'Landscape.' },
    { id: 'facilities.zone.intense-exercise', page: 'facilities', section: 'zones', label: 'Intense Exercise', kind: 'image', defaultSrc: '/images/service-intense-exercise.jpg', hint: 'Landscape.' },

    // ── Brand ─────────────────────────────────────────────────────
    { id: 'brand.logo', page: 'brand', section: 'logo', label: 'Logo', kind: 'image', defaultSrc: '/images/sol-logo-terra.png', hint: 'PNG with transparent background. Shown small, so keep it simple.' },
];

export const SITE_MEDIA_SLOT_IDS = new Set(SITE_MEDIA_SLOTS.map((s) => s.id));

export function getSiteMediaSlot(id: string): SiteMediaSlot | undefined {
    return SITE_MEDIA_SLOTS.find((s) => s.id === id);
}

export const SITE_MEDIA_LIMITS = {
    imageBytes: 15 * 1024 * 1024,
    videoBytes: 150 * 1024 * 1024,
    imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
} as const;

/** Map of slot id → public URL of the admin-uploaded replacement. */
export type SiteMediaOverrides = Record<string, string>;
