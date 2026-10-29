"use client";

import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, useScroll, useTransform } from "framer-motion";
import { MobileMenu } from "./MobileMenu";

export function Header() {
    const media = useSiteMedia();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const pathname = usePathname();
    // Pages with a light background need dark nav text even before scrolling
    const isLightPage = pathname !== "/";

    const { scrollY } = useScroll();
    const headerBg = useTransform(
        scrollY,
        [0, 80],
        ["rgba(255,245,237,0)", "rgba(255,245,237,0.97)"]
    );

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 60);
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const useDarkText = isScrolled || isLightPage;
    const linkClass = useDarkText
        ? "text-olive-300 font-medium hover:text-terra-400 transition-colors text-sm tracking-wider"
        : "text-peach-100/90 font-medium hover:text-peach-50 transition-colors text-sm tracking-wider";

    return (
        <>
            <motion.header
                style={{ backgroundColor: headerBg }}
                className={`fixed top-0 left-0 right-0 z-50 border-b ${isScrolled ? "backdrop-blur-md border-peach-400" : "border-transparent"}`}
            >
                <div className="container mx-auto px-8 py-4 flex items-center justify-between">
                    {/* Logo */}
                    <Link href="/" className="relative z-50 rounded-lg transition-all duration-300">
                        <Image
                            src={media.src("brand.logo", "/images/sol-logo-terra.png")}
                            alt="SOL Pilates Studio"
                            width={400}
                            height={400}
                            className="h-28 md:h-32 w-auto -my-8 md:-my-10"
                        />
                    </Link>

                    {/* Desktop Nav Links */}
                    <nav className="hidden md:flex items-center gap-8">
                        <Link href="/" className={linkClass}>HOME</Link>
                        <Link href="/subscription" className={linkClass}>PRICING</Link>
                        <Link href="/user/schedule" className={linkClass}>SCHEDULE</Link>
                        <Link href="/our-story" className={linkClass}>OUR STORY</Link>
                        <Link href="/shop" className={linkClass}>SHOP</Link>
                        <Link href="/contact" className={linkClass}>CONTACT US</Link>
                        {/* <Link href="/feedback" className={linkClass}>FEEDBACK</Link> */}
                    </nav>

                    {/* Right side */}
                    <div className="flex items-center gap-4">
                        <Link
                            href="/subscription"
                            className={`hidden md:block px-6 py-3 font-bold text-sm tracking-wider transition-all border ${useDarkText ? "border-terra-400 text-terra-400 hover:bg-terra-400 hover:text-peach-50" : "border-peach-100 text-peach-100 hover:bg-peach-100 hover:text-warmDark-800"}`}
                        >
                            BOOK NOW
                        </Link>
                        <button
                            onClick={() => setIsMenuOpen(true)}
                            className="md:hidden w-10 h-10 flex flex-col items-center justify-center gap-1.5 group p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <span className={`w-6 h-0.5 group-hover:scale-x-75 transition-transform origin-right ${useDarkText ? "bg-olive-400" : "bg-peach-100"}`}></span>
                            <span className={`w-6 h-0.5 ${useDarkText ? "bg-olive-400" : "bg-peach-100"}`}></span>
                            <span className={`w-6 h-0.5 group-hover:scale-x-75 transition-transform origin-right ${useDarkText ? "bg-olive-400" : "bg-peach-100"}`}></span>
                        </button>
                    </div>
                </div>
            </motion.header>

            {/* Mobile Menu Overlay */}
            <MobileMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
        </>
    );
}
