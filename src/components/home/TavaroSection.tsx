"use client";

import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import { useRef } from "react";
import Image from "next/image";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";

// ============================================================
//  TAVARO SECTION — edit this block to change anything visual
// ============================================================
const COPY = {
  badge: "OPENING JULY 2026 · HYDERABAD",
  headline: "A space that makes showing up the easy part.",
  body: "Sol Pilates Studio is inside Tavaro Resorts. Beautiful, intentional and designed to make every visit feel like more than just a workout.",
};

const IMAGES = {
  hero: { src: "/images/97.jpeg", alt: "Tavaro Resorts hero" },
  grounds: {
    src: "/images/Studio.jpeg",
    alt: "Tavaro grounds, pool, lobby",
  },
  // TODO: add /public/images/tavaro/studio.jpg
  studio: {
    src: "/images/Studio_in_construction.jpeg",
    alt: "Studio space, under construction",
    caption: "Studio in construction",
  },
};

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ============================================================
//  Component
// ============================================================
export function TavaroSection() {
  const media = useSiteMedia();
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  // Internal parallax: construction image drifts gently while the finished-space images stay fully visible.
  const smallImageY = useTransform(scrollYProgress, [0, 1], ["5%", "-5%"]);

  // Clip-path directions for diagonal cascade:
  //   Big left  : top-down   inset(100% 0 0 0) → inset(0 0 0 0)
  //   Top right : left-to-right  inset(0 100% 0 0) → inset(0 0 0 0)
  //   Bot right : right-to-left  inset(0 0 0 100%) → inset(0 0 0 0)
  const clipBig = { hidden: "inset(100% 0 0 0)", visible: "inset(0% 0 0 0)" };
  const clipTopRight = {
    hidden: "inset(0 100% 0 0)",
    visible: "inset(0 0% 0 0)",
  };
  const clipBotRight = {
    hidden: "inset(0 0 0 100%)",
    visible: "inset(0 0 0 0%)",
  };

  const maskVariant = (
    clip: { hidden: string; visible: string },
    delay: number
  ) =>
    prefersReduced
      ? {
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { duration: 0.4, delay } },
        }
      : {
          hidden: { clipPath: clip.hidden, opacity: 1 },
          visible: {
            clipPath: clip.visible,
            opacity: 1,
            transition: { duration: 1.2, delay, ease: E },
          },
        };

  return (
    <section ref={sectionRef} className="bg-peach-200 py-24 md:py-32">
      <div className="container mx-auto px-8">
        {/* Header */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-15%" }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.15 } } }}
        >
          <motion.span
            variants={{
              hidden: { opacity: 0, scale: 0.92 },
              visible: {
                opacity: 1,
                scale: 1,
                transition: { duration: 0.6, ease: E },
              },
            }}
            className="inline-block border border-terra-400/40 text-terra-400 text-[11px] tracking-[0.2em] uppercase px-4 py-1.5 rounded-full bg-terra-400/5"
          >
            {COPY.badge}
          </motion.span>

          <div className="overflow-hidden mt-6 pb-2">
            <motion.h2
              variants={{
                hidden: { y: "100%" },
                visible: {
                  y: "0%",
                  transition: { duration: 1.0, delay: 0.15, ease: E },
                },
              }}
              className="font-display font-black text-4xl md:text-5xl text-olive-600 max-w-3xl leading-[1.05]"
            >
              {COPY.headline}
            </motion.h2>
          </div>

          <motion.p
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.7, delay: 0.35, ease: E },
              },
            }}
            className="text-olive-400 text-lg leading-relaxed mt-4 max-w-2xl"
          >
            {COPY.body}
          </motion.p>
        </motion.div>

        {/* Image grid — diagonal cascade */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-10%" }}
        >
          {/* Big left image: top-down reveal */}
          <motion.div
            variants={maskVariant(clipBig, 0)}
            className="md:col-span-2 relative aspect-[4/3] md:aspect-auto md:h-[500px] rounded-2xl overflow-hidden"
          >
            <div className="absolute inset-0 bg-peach-300" aria-hidden="true" />
            <motion.div className="absolute inset-0">
              <Image
                src={media.src("home.tavaro.hero", IMAGES.hero.src)}
                alt={IMAGES.hero.alt}
                fill
                className="object-cover object-center"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </motion.div>
          </motion.div>

          {/* Right column: two images */}
          <div className="grid grid-rows-2 gap-4">
            {/* Top-right: left-to-right reveal */}
            <motion.div
              variants={maskVariant(clipTopRight, 0.18)}
              className="relative aspect-[4/3] md:aspect-auto rounded-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-peach-300" aria-hidden="true" />
              <motion.div className="absolute inset-0">
                <Image
                  src={media.src("home.tavaro.grounds", IMAGES.grounds.src)}
                  alt={IMAGES.grounds.alt}
                  fill
                  className="object-cover object-center"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </motion.div>
            </motion.div>

            {/* Bottom-right: right-to-left reveal */}
            <motion.div
              variants={maskVariant(clipBotRight, 0.36)}
              className="relative aspect-[4/3] md:aspect-auto rounded-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-peach-300" aria-hidden="true" />
              <motion.div
                className="absolute -inset-6"
                style={prefersReduced ? {} : { y: smallImageY }}
              >
                <Image
                  src={media.src("home.tavaro.studio", IMAGES.studio.src)}
                  alt={IMAGES.studio.alt}
                  fill
                  className="object-cover object-center"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </motion.div>
              {/* Caption animates in after image lands */}
              <motion.span
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 1.0, ease: E }}
                className="absolute bottom-3 left-3 text-xs text-olive-400 bg-peach-100/90 px-3 py-1.5 rounded"
              >
                {IMAGES.studio.caption}
              </motion.span>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
