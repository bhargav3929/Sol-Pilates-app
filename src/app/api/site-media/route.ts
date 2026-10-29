import { NextResponse } from 'next/server';
import { getSiteMediaOverrides } from '@/lib/site-media/store';

// Public: slot id → URL for every admin-replaced website image or video.
// Cached for a minute; the admin route revalidates it on every change.
export const revalidate = 60;

export async function GET() {
    try {
        const overrides = await getSiteMediaOverrides();
        return NextResponse.json({ overrides });
    } catch (error) {
        console.error('[site-media] GET failed', error);
        return NextResponse.json({ overrides: {} }, { status: 200 });
    }
}
