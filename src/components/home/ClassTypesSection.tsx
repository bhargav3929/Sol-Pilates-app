"use client";

import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import Image from "next/image";
import { motion } from "framer-motion";

// ============================================================
//  CLASS TYPES SECTION — edit this block to change anything visual
// ============================================================
const STYLES = {
  section: "relative overflow-hidden bg-peach-100 py-24 md:py-32",
  headerWrap: "container mx-auto px-8 text-center",
  eyebrow: "text-xs font-bold uppercase tracking-[0.3em] text-terra-400",
  headline: "mx-auto mt-4 max-w-4xl font-display text-4xl font-black leading-none text-olive-600 md:text-6xl",
  intro: "mx-auto mt-5 max-w-2xl text-base leading-8 text-olive-400 md:text-lg",
  stack:
    "mt-14 grid gap-5 px-6 md:container md:mx-auto md:mt-20 md:max-w-7xl md:grid-cols-3 md:px-8",
  card:
    "group relative overflow-hidden border border-olive-600/10 bg-peach-200",
  imageWrap: "relative h-[18rem] overflow-hidden bg-peach-300 md:h-[22rem]",
  image: "object-cover",
  overlay: "absolute inset-0 bg-[linear-gradient(to_top,rgba(30,24,21,0.72)_0%,rgba(30,24,21,0.18)_48%,rgba(30,24,21,0.04)_100%)]",
  textWrap: "relative px-5 py-6 md:px-6 md:py-7",
  statusPill:
    "inline-flex border border-terra-400/40 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-terra-400",
  cardName: "font-display text-4xl font-black leading-none text-olive-600 md:text-5xl",
  cardBody: "mt-4 text-sm leading-7 text-olive-400 md:text-base md:min-h-[7rem]",
  detailGrid: "mt-5 grid gap-2",
  detail:
    "border border-olive-600/10 bg-peach-100/70 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-olive-500",
};

const COPY = {
  headline: "One Studio, Three ways to move",
  intro:
    "Pick the track your body needs today. Each class has its own intensity, pace, and purpose, so the choice feels clear before you book.",
};

const CLASSES = [
  {
    name: "Sol Flow",
    status: null as string | null,
    number: "01",
    rhythm: "Continuous",
    intensity: "Strength",
    bestFor: "Core control",
    body: "Strength meets movement in one seamless sequence. No breaks, no rush. Just continuous work that builds your body and clears your mind.",
    slot: "home.class-types.sol-flow",
    image: "/images/IMG_9836.jpeg",
    alt: "Long stretch",
  },
  {
    name: "Sol Cardio",
    status: "Coming soon" as string | null,
    number: "02",
    rhythm: "High energy",
    intensity: "Cardio",
    bestFor: "Endurance",
    body: "High-energy boutique sequences that build endurance and leave you breathless (in the best way).",
    slot: "home.class-types.sol-cardio",
    image: "/images/IMG_0003.jpeg",
    alt: "Jumpboard",
  },
  {
    name: "Sol Stretch",
    status: "Coming soon" as string | null,
    number: "03",
    rhythm: "Slow reset",
    intensity: "Recovery",
    bestFor: "Mobility",
    body: "Your body's reset button. Long, intentional stretches that undo tension and restore the way you were meant to move.",
    slot: "home.class-types.sol-stretch",
    image: "/images/IMG_9787_.jpeg",
    alt: "Mermaid",
  },
];

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

type ClassItem = (typeof CLASSES)[0];

function ClassStoryCard({
  cls,
  index,
}: {
  cls: ClassItem;
  index: number;
}) {
  const media = useSiteMedia();
  return (
    <motion.article
      className={STYLES.card}
      initial={{ opacity: 0, y: 44 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.24 }}
      transition={{ duration: 0.75, ease: E, delay: index * 0.08 }}
    >
      <div className={STYLES.imageWrap}>
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          whileInView={{ scale: 1 }}
          whileHover={{ scale: 1.045 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.95, ease: E }}
        >
            <Image
              src={media.src(cls.slot, cls.image)}
              alt={cls.alt}
              fill
              className={STYLES.image}
              sizes="(min-width: 768px) 33vw, 100vw"
            />
        </motion.div>
        <div className={STYLES.overlay} />
        <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
          <span className="font-display text-6xl font-black leading-none text-peach-50/85 md:text-7xl">
            {cls.number}
          </span>
          {cls.status && <span className="border border-peach-50/35 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-peach-50 backdrop-blur-md">{cls.status}</span>}
        </div>
      </div>

      <div className={STYLES.textWrap}>
        <div className="flex min-h-[3.25rem] items-start justify-between gap-4">
          <h3 className={STYLES.cardName}>{cls.name}</h3>
          {cls.status && (
              <div className="relative hidden overflow-hidden lg:block">
              {/* <span className={STYLES.statusPill}>{cls.status}</span> */}
              <span
                className="shimmer-pill absolute inset-0 pointer-events-none"
                aria-hidden="true"
              />
            </div>
          )}
        </div>
        <p className={STYLES.cardBody}>{cls.body}</p>
        <div className={STYLES.detailGrid}>
          <span className={STYLES.detail}>{cls.rhythm}</span>
          <span className={STYLES.detail}>{cls.intensity}</span>
          <span className={STYLES.detail}>{cls.bestFor}</span>
        </div>
      </div>
    </motion.article>
  );
}

// ============================================================
//  Component
// ============================================================
export function ClassTypesSection() {
  return (
    <section className={STYLES.section}>
      {/* Section headline */}
      <div className={STYLES.headerWrap}>
        <span className={STYLES.eyebrow}>Class types</span>
        <div className="overflow-hidden pb-2">
          <motion.h2
            className={STYLES.headline}
            initial={{ y: "100%" }}
            whileInView={{ y: "0%" }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{ duration: 1.0, ease: [...E] }}
          >
            {COPY.headline}
          </motion.h2>
        </div>
        <motion.p
          className={STYLES.intro}
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-20%" }}
          transition={{ duration: 0.7, ease: [...E], delay: 0.12 }}
        >
          {COPY.intro}
        </motion.p>
      </div>

      <div className={STYLES.stack}>
        {CLASSES.map((cls, index) => (
          <ClassStoryCard key={cls.name} cls={cls} index={index} />
        ))}
      </div>
    </section>
  );
}
