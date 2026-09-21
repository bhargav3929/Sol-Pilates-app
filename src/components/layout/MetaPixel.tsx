'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { META_PIXEL_ID, trackPixel } from '@/lib/meta-pixel'

const isAdminPath = (path: string | null) => !!path?.startsWith('/admin')

export function MetaPixel() {
    const pathname = usePathname()
    const initialPath = useRef<string | null>(pathname)

    // The base snippet tracks the first PageView; this covers client-side navigations.
    useEffect(() => {
        if (pathname === initialPath.current) return
        initialPath.current = null
        if (!isAdminPath(pathname)) trackPixel('PageView')
    }, [pathname])

    // Staff traffic on the admin panel would pollute ad audiences.
    if (!META_PIXEL_ID || isAdminPath(pathname)) return null

    return (
        <>
            <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
            </Script>
            <noscript>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    height="1"
                    width="1"
                    style={{ display: 'none' }}
                    alt=""
                    src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
                />
            </noscript>
        </>
    )
}
