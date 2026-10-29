"use client";

import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Instagram } from "lucide-react";
import {
  motion,
  useScroll,
  useVelocity,
  useSpring,
  useTransform,
  useMotionValue,
  useAnimationFrame,
  useReducedMotion,
} from "framer-motion";

// ============================================================
//  INSTAGRAM SECTION — edit this block to change anything visual
// ============================================================
const COPY = {
  headline: "Follow the journey.",
  body: "Daily movement cues, behind-the-scenes from the studio, and stories from our community.",
  handle: "pilates.with.swetha",
  url: "https://instagram.com/",
};

// TODO: replace with real IG-fed thumbs when API integration ships
const THUMB_DEFAULTS = [
  "/images/sol-pilates-mat-brown.jpeg",
  "/images/sol-pilates-mat-olive.jpeg",
  "/images/service-muscle-recovery.jpg",
  "/images/service-reset-restore.jpg",
  "/images/service-strength-sculpt.jpg",
  "/images/service-cardio-endurance.jpg",
];

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Wraps a continuously-decreasing/increasing value
function wrapValue(min: number, max: number, v: number): number {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
}

// ── Single marquee row ───────────────────────────────────────

function ThumbRow({
  thumbs,
  direction,
  speed,
}: {
  thumbs: string[];
  direction: 1 | -1;
  speed: number;
}) {
  const x = useMotionValue(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const [halfWidth, setHalfWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (stripRef.current) {
      setHalfWidth(stripRef.current.scrollWidth / 2);
    }
  }, []);

  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, {
    damping: 50,
    stiffness: 400,
  });
  const velocityFactor = useTransform(smoothVelocity, [-3000, 3000], [-3, 3]);

  useAnimationFrame((_, delta) => {
    if (prefersReduced || paused || halfWidth === 0) return;
    const boost = Math.max(-30, Math.min(30, velocityFactor.get() * 10));
    const move = direction * (speed + boost) * (delta / 1000);
    x.set(wrapValue(-halfWidth, 0, x.get() + move));
  });

  const all = [...thumbs, ...thumbs];

  if (prefersReduced) return null;

  return (
    <a
      href={COPY.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Instagram"
      className="block overflow-hidden relative isolate"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <motion.div ref={stripRef} className="flex gap-2" style={{ x }}>
        {all.map((src, i) => (
          <motion.div
            key={i}
            className="relative w-40 h-40 md:w-48 md:h-48 flex-shrink-0 overflow-hidden rounded-none bg-peach-300"
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.3 }}
          >
            <Image
              src={src}
              alt={`Instagram post ${(i % thumbs.length) + 1}`}
              fill
              sizes="192px"
              className="object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </motion.div>
        ))}
      </motion.div>
    </a>
  );
}

// ── Reduced-motion static grid ───────────────────────────────

function ThumbGrid({ thumbs }: { thumbs: string[] }) {
  return (
    <a
      href={COPY.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Instagram"
      className="grid grid-cols-3 md:grid-cols-6 gap-2"
    >
      {thumbs.slice(0, 6).map((src, i) => (
        <div
          key={i}
          className="relative aspect-square overflow-hidden rounded-none bg-peach-300"
        >
          <Image
            src={src}
            alt={`Instagram post ${i + 1}`}
            fill
            className="object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ))}
    </a>
  );
}

// ============================================================
//  Component
// ============================================================
export function InstagramSection(props: {
  id?: string,
  hideImages?: boolean,
}) {
  const media = useSiteMedia();
  const THUMBS = THUMB_DEFAULTS.map((src, i) => media.src(`home.instagram.${i + 1}`, src));
  const prefersReduced = useReducedMotion();

  return (
    <section className="bg-peach-300 py-20 border-t border-olive-400/10 overflow-hidden">
      <div className="container mx-auto px-8">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: 0.5, ease: [...E] }}
          >
            <motion.div
              whileHover={prefersReduced ? undefined : { rotate: 8 }}
              transition={{ duration: 0.4 }}
              className="inline-block mb-4"
            >
              <Instagram className="w-10 h-10 text-terra-400" />
            </motion.div>
          </motion.div>

          <div className="overflow-hidden pb-2">
            <motion.h2
              initial={prefersReduced ? { opacity: 0 } : { y: "100%" }}
              whileInView={{ y: "0%", opacity: 1 }}
              viewport={{ once: true, margin: "-15%" }}
              transition={{ duration: 1.0, ease: [...E] }}
              className="text-3xl md:text-5xl font-black text-olive-600 tracking-normal font-display"
            >
              {COPY.headline}
            </motion.h2>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: 0.7, delay: 0.15, ease: [...E] }}
            className="text-olive-400 mt-4 max-w-md mx-auto"
          >
            {COPY.body}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-15%" }}
            transition={{ duration: 0.6, delay: 0.3, ease: [...E] }}
          >
            <Link
              href={COPY.url + props.id}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 mt-8 px-8 py-4 bg-terra-400 text-peach-50 font-black text-xs tracking-widest uppercase hover:bg-terra-300 transition-all shadow-glow"
            >
              <Instagram className="w-4 h-4" />
              {props.id}
            </Link>
          </motion.div>
        </div>

        {/* Two counter-scrolling marquee rows (or static grid) */}
        {!props.hideImages && <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.9, delay: 0.2, ease: [...E] }}
          className="flex flex-col gap-2 relative isolate"
          style={{ overflow: "hidden" }}
        >
          {prefersReduced ? (
            <ThumbGrid thumbs={THUMBS} />
          ) : (
            <>
              <ThumbRow thumbs={THUMBS} direction={-1} speed={60} />
              <div className="mt-2">
                <ThumbRow thumbs={THUMBS} direction={1} speed={60} />
              </div>
            </>
          )}
        </motion.div>}
      </div>
    </section>
  );
}
