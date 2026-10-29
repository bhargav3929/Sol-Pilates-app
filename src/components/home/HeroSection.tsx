"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { GetStartedModal } from "@/components/auth/GetStartedModal";
import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import { useClientAuthStore } from "@fitconnect/shared/stores/clientAuthStore";

// ============================================================
//  HERO SECTION — edit this block to change anything visual
// ============================================================
const STYLES = {
  section:
    "relative min-h-screen w-full flex items-center justify-center overflow-hidden",
  videoWrap: "absolute inset-0 w-full h-full z-0 bg-warmDark-800",
  video: "absolute inset-0 w-full h-full object-cover",
  overlay: "absolute inset-0 bg-warmDark-800 z-[1]",
  container: "relative z-10 container mx-auto px-8 text-center",
  eyebrow:
    "block text-xs font-bold tracking-[0.3em] uppercase text-peach-200/70 mb-4",
  headline:
    "font-display font-black tracking-normal leading-[0.95] text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-peach-50 drop-shadow-xl uppercase text-center w-full",
  body: "mt-6 md:mt-8 text-lg md:text-xl text-peach-200/90 max-w-2xl mx-auto leading-relaxed",
  ctaRow:
    "mt-10 md:mt-12 flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-center",
  primaryBtn:
    "block w-full sm:w-auto text-center px-10 py-5 bg-terra-400 text-peach-50 font-black text-xs md:text-sm tracking-widest uppercase hover:bg-terra-300 transition-all shadow-glow",
  secondaryBtn:
    "cursor-pointer block w-full sm:w-auto text-center px-10 py-5 border-2 border-peach-50 text-peach-50 font-black text-xs md:text-sm tracking-widest uppercase hover:bg-peach-50 hover:text-warmDark-800 transition-all",
};

const COPY = {
  eyebrow: "Boutique Pilates · Kokapet · Hyderabad",
  headlineLine1: "Strong body.",
  headlineLine2: "Pain-free life.",
  body: "Contrology-based Pilates in a resort studio designed to make you feel as good as it looks.",
  primaryCta: { label: "Claim Your Demo Class", href: "/intro-class" },
  secondaryCta: { label: "Get Started" },
};

const MEDIA = {
  // TODO: swap to new hero video when ready (Pilates-in-studio shot)
  videoSrc: "/videos/Background_option_1.mp4",
  poster: "/images/sol-hero-poster.jpeg",
};

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ============================================================
//  Component
// ============================================================
export function HeroSection() {
  const media = useSiteMedia();
  const heroVideoSrc = media.src("home.hero.video", MEDIA.videoSrc);
  const heroPoster = media.src("home.hero.poster", MEDIA.poster);
  const router = useRouter();
  const { isAuthenticated } = useClientAuthStore();
  const [showGetStarted, setShowGetStarted] = useState(false);

  const heroRef = useRef<HTMLElement>(null);
  const videoInnerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const prefersReduced = useReducedMotion();

  // If video loads from cache before React attaches onLoadedData, readyState
  // is already ≥ 2 on mount — catch that case here.
  useEffect(() => {
    if (videoRef.current && videoRef.current.readyState >= 2) {
      setVideoReady(true);
    }
  }, []);

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  // Overlay deepens as hero scrolls out
  const overlayOpacity = useTransform(scrollYProgress, [0, 1], [0.55, 0.85]);

  useGSAP(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (prefersReduced || !videoInnerRef.current || !heroRef.current) return;
    gsap.to(videoInnerRef.current, {
      yPercent: -12,
      ease: "none",
      scrollTrigger: {
        trigger: heroRef.current,
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });
  }, [prefersReduced]);

  const handleGetStarted = () => {
    if (isAuthenticated) {
      router.push("/user/dashboard");
    } else {
      setShowGetStarted(true);
    }
  };

  return (
    <section ref={heroRef} className={STYLES.section}>
      {/* Ken Burns scale (1.05 → 1) + fade in on mount */}
      <motion.div
        initial={prefersReduced ? { opacity: 0 } : { scale: 1.05, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          scale: { duration: 6, ease: [...E] },
          opacity: { duration: 0.8, ease: "easeOut" },
        }}
        className={STYLES.videoWrap}
      >
        <div ref={videoInnerRef} className="absolute inset-0">
          <video
            key={heroVideoSrc}
            ref={videoRef}
            poster={heroPoster}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onLoadedData={handleVideoReady}
            className={STYLES.video}
            style={{ opacity: videoReady ? 1 : 0, transition: "opacity 0.6s ease-out" }}
          >
            {heroVideoSrc === MEDIA.videoSrc && (
              <source src="/videos/Background_option_1.webm" type="video/webm" />
            )}
            <source src={heroVideoSrc} type={heroVideoSrc.endsWith(".webm") ? "video/webm" : "video/mp4"} />
          </video>
        </div>
      </motion.div>

      {/* Scroll-linked overlay — deepens as user scrolls past hero */}
      <motion.div
        className={STYLES.overlay}
        style={prefersReduced ? { opacity: 0.55 } : { opacity: overlayOpacity }}
      />

      <div className={STYLES.container}>
        <motion.span
          initial={prefersReduced ? undefined : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [...E] }}
          className={STYLES.eyebrow}
        >
          Boutique Pilates · <em>Kokapet</em> · Hyderabad
        </motion.span>

        {/* Headline — line-by-line mask reveal (y: 110% → 0%) */}
        <h1 className={STYLES.headline}>
          <span className="block overflow-hidden pb-2">
            <motion.span
              className="block"
              initial={prefersReduced ? undefined : { y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 1.1, delay: 0.3, ease: [...E] }}
            >
              {COPY.headlineLine1}
            </motion.span>
          </span>
          <span className="block overflow-hidden pb-2">
            <motion.span
              className="block"
              initial={prefersReduced ? undefined : { y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 1.1, delay: 0.42, ease: [...E] }}
            >
              {COPY.headlineLine2}
            </motion.span>
          </span>
        </h1>

        <motion.p
          initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.9, ease: [...E] }}
          className={STYLES.body}
        >
          {COPY.body}
        </motion.p>

        <div className={STYLES.ctaRow}>
          {/* Primary CTA with ambient glow pulse */}
          <motion.div
            initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.05, ease: [...E] }}
            className="relative w-full sm:w-auto"
          >
            {!prefersReduced && (
              <motion.span
                className="absolute inset-0 -z-10 blur-xl bg-terra-400/30 rounded-full"
                animate={{ opacity: [0.35, 0.8, 0.35] }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 2.5,
                }}
                aria-hidden
              />
            )}
            <Link href={COPY.primaryCta.href} className={STYLES.primaryBtn}>
              {COPY.primaryCta.label}
            </Link>
          </motion.div>

          {/* Secondary CTA — 0.08s after primary */}
          <motion.div
            initial={prefersReduced ? undefined : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.13, ease: [...E] }}
          className="w-full sm:w-auto"
          >
            <button onClick={handleGetStarted} className={STYLES.secondaryBtn}>
              {COPY.secondaryCta.label}
            </button>
          </motion.div>
        </div>
      </div>


      <GetStartedModal
        isOpen={showGetStarted}
        onClose={() => setShowGetStarted(false)}
      />
    </section>
  );
}
