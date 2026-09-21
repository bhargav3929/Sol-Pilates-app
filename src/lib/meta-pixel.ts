type StandardEvent = 'PageView' | 'Lead' | 'CompleteRegistration' | 'Purchase' | 'Subscribe'

type EventParams = {
    value?: number
    currency?: string
    content_name?: string
    predicted_ltv?: number
    [key: string]: unknown
}

declare global {
    interface Window {
        fbq?: (command: 'track' | 'init', event: string, params?: EventParams) => void
    }
}

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

export function trackPixel(event: StandardEvent, params?: EventParams) {
    if (typeof window === 'undefined' || !window.fbq) return
    window.fbq('track', event, params)
}

// Razorpay amounts are in the smallest currency unit (paise).
export function toMajorUnits(amount: number) {
    return amount / 100
}
