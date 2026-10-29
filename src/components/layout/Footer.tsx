"use client";
import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import Link from 'next/link';
import Image from 'next/image';
import { Instagram } from 'lucide-react';
import { Reveal } from '@/lib/animation/Reveal';

const SOL_INSTAGRAM_URL = "https://instagram.com/pilates.with.swetha";

const COPY = {
    watermark: "SOL PILATES",
    logoAlt: "SOL Pilates Studio",
    brandTagline:
        "Contrology-based Pilates inside Tavaro Resorts, Hyderabad. Strength-led. Pain-free. Built to last.",
    instagramAriaLabel: "Instagram",
    servicesHeading: "SERVICES",
    servicesLinks: [
        { label: "Sol Flow", href: "/subscription" },
        { label: "Sol Cardio", href: "/subscription" },
        { label: "Sol Stretch", href: "/subscription" },
    ],
    studioHeading: "STUDIO",
    studioLinks: [
        { label: "Our Story", href: "/our-story" },
        { label: "Contact", href: "/contact" },
    ],
    legalHeading: "LEGAL",
    legalLinks: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
        { label: "Studio Policies", href: "/policies" },
        { label: "Contact", href: "/contact" },
    ],
    newsletterHeading: "STAY CONNECTED",
    newsletterBody:
        "Be the first to know about classes, founding member spots and studio updates.",
    newsletterPlaceholder: "Enter your email",
    newsletterCta: "Subscribe",
    copyright: "SOL Pilates Studio. All rights reserved.",
    bottomLinks: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
        { label: "Policies", href: "/policies" },
        { label: "Contact", href: "/contact" },
    ],
};

export function Footer() {
    const media = useSiteMedia();
    return (
        <Reveal variant="slideUp" as="footer" duration={0.8} className="bg-warmDark-800 text-peach-200 py-20 relative overflow-hidden">
            {/* Cinematic Watermark */}
            <div className="hidden md:flex absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none select-none items-center justify-center opacity-[0.03]">
                <span className="font-black uppercase text-peach-200 stroke-text leading-none whitespace-nowrap font-display" style={{ fontSize: "clamp(2rem, 13vw, 30rem)", letterSpacing: "-0.02em" }}>
                    {COPY.watermark}
                </span>
            </div>

            <div className="container mx-auto px-6 relative z-10">
                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 mb-20">

                    {/* 1. Brand Section (Left) - Spans 4 columns */}
                    <div className="lg:col-span-4 space-y-8">
                        <Link href="/" className="inline-block group">
                            <Image
                                src={media.src("brand.logo", "/images/sol-logo-terra.png")}
                                alt={COPY.logoAlt}
                                width={400}
                                height={400}
                                className="h-28 md:h-32 w-auto group-hover:opacity-80 transition-opacity duration-300"
                            />
                        </Link>
                        <p className="text-peach-400 leading-relaxed max-w-sm font-medium">
                            {COPY.brandTagline}
                        </p>
                        {/* <div className="flex gap-4">
                            <a
                                href={SOL_INSTAGRAM_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={COPY.instagramAriaLabel}
                                className="w-10 h-10 rounded-full bg-peach-200/5 border border-peach-200/10 flex items-center justify-center text-peach-200 hover:bg-terra-400 hover:text-peach-50 hover:border-terra-400 hover:scale-110 transition-all duration-300"
                            >
                                <Instagram className="w-4 h-4" />
                            </a>
                        </div> */}
                    </div>

                    {/* 2. Links Section (Center) - Spans 5 columns */}
                    <div className="lg:col-span-5 grid grid-cols-2 md:grid-cols-3 gap-8">
                        <div>
                            <h4 className="font-bold text-peach-200 mb-6 tracking-wide">{COPY.servicesHeading}</h4>
                            <ul className="space-y-4">
                                {COPY.servicesLinks.map(item => (
                                    <li key={item.label}>
                                        <Link href={item.href} className="text-sm text-peach-400 hover:text-terra-300 transition-colors block hover:translate-x-1 duration-200 py-1.5">
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-peach-200 mb-6 tracking-wide">{COPY.studioHeading}</h4>
                            <ul className="space-y-4">
                                {COPY.studioLinks.map(item => (
                                    <li key={item.label}>
                                        <Link href={item.href} className="text-sm text-peach-400 hover:text-terra-300 transition-colors block hover:translate-x-1 duration-200 py-1.5">
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-peach-200 mb-6 tracking-wide">{COPY.legalHeading}</h4>
                            <ul className="space-y-4">
                                {COPY.legalLinks.map(item => (
                                    <li key={item.label}>
                                        <Link href={item.href} className="text-sm text-peach-400 hover:text-terra-300 transition-colors block hover:translate-x-1 duration-200 py-1.5">
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* 3. Newsletter Section (Right) - hidden until wired up */}

                </div>

                {/* Bottom Bar */}
                <div className="border-t border-peach-200/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-xs text-peach-400 font-medium">
                        &copy; {new Date().getFullYear()} {COPY.copyright}
                    </p>
                    <div className="flex gap-6">
                        {COPY.bottomLinks.map((item, idx) => (
                            <span key={item.label} className="flex items-center gap-6">
                                <Link href={item.href} className="text-xs text-peach-400 hover:text-terra-300 transition-colors font-medium">
                                    {item.label}
                                </Link>
                                {idx < COPY.bottomLinks.length - 1 && (
                                    <span className="text-warmDark-700">&bull;</span>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </Reveal>
    );
}
