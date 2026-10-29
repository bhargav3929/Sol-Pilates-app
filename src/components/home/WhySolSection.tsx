"use client";

import { useSiteMedia } from "@/lib/hooks/useSiteMedia";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/lib/animation/Reveal";

// ============================================================
//  WHY SOL SECTION — edit this block to change anything visual
// ============================================================
const STYLES = {
  section: "bg-peach-200 py-24 md:py-32",
  container: "container mx-auto px-8",
  headerWrap: "text-center",
  eyebrow:
    "text-xs font-bold tracking-[0.3em] uppercase text-terra-400 block mb-4",
    headline: "font-display font-black text-4xl md:text-6xl text-olive-600 mt-2",
  grid: "grid grid-cols-1 md:grid-cols-3 gap-6 mt-16",
  cardImageOuter: "overflow-hidden aspect-[4/5] w-full relative rounded-none",
  cardImagePlaceholder: "absolute inset-0 bg-peach-300",
  cardImage: "object-cover",
  cardLabel:
    "font-display font-bold text-xl md:text-2xl text-olive-600 mt-6",
  cardBody: "text-olive-400 text-base leading-relaxed mt-3 max-w-sm",
};

const COPY = {
  eyebrow: "THE STUDIO",
  headline: "Why Sol",
};

const CARDS = [
  {
    label: "The Method",
    body: "Rooted in Contrology — the original Pilates system. Strength training principles built in, not bolted on.",
    slot: "home.why-sol.method",
    image: "/images/IMG_9731.jpeg",
    alt: "Pilates instructor demonstrating a Contrology move",
  },
  {
    label: "The Space",
    body: "Inside Tavaro Resorts, Hyderabad. A studio that feels like a destination, because it is.",
    slot: "home.why-sol.space",
    image: "/images/IMG_0992_.jpeg",
    alt: "Tavaro Resorts grounds",
  },
  {
    label: "The Result",
    body: "Less pain. More strength. A body that works for the life you're actually living.",
    slot: "home.why-sol.result",
    image: "/images/IMG_9901.jpeg",
    alt: "Client living an active daily life",
  },
];

const E: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Card component — extracts image clip-path animation (cannot call hooks in .map)
function WhySolCard({ card, index }: { card: (typeof CARDS)[0]; index: number }) {
  const media = useSiteMedia();
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      variants={
        prefersReduced
          ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
          : {
              hidden: { opacity: 0, y: 60 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 1.0, ease: [...E] },
              },
            }
      }
    >
      {/* Image — clip-path wipe top-down */}
      <motion.div
        className={STYLES.cardImageOuter}
        variants={
          prefersReduced
            ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
            : {
                hidden: { clipPath: "inset(0 0 100% 0)" },
                visible: {
                  clipPath: "inset(0 0 0% 0)",
                  transition: {
                    duration: 1.2,
                    delay: 0.1,
                    ease: [...E],
                  },
                },
              }
        }
      >
        <div className={STYLES.cardImagePlaceholder} aria-hidden="true" />
        {/* Hover scale on the image, not the card */}
        <motion.div
          className="absolute inset-0"
          whileHover={prefersReduced ? undefined : { scale: 1.04 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Image
            src={media.src(card.slot, card.image)}
            alt={card.alt}
            fill
            className={STYLES.cardImage}
            sizes="(min-width: 768px) 33vw, 100vw"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </motion.div>
      </motion.div>

      {/* Text — rises after image wipe */}
      <motion.div
        variants={
          prefersReduced
            ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
            : {
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.7, delay: 0.4, ease: [...E] },
                },
              }
        }
      >
        <h3 className={STYLES.cardLabel}>{card.label}</h3>
        <p className={STYLES.cardBody}>{card.body}</p>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
//  Component
// ============================================================
export function WhySolSection() {
  const prefersReduced = useReducedMotion();

  return (
    <section className={STYLES.section}>
      <div className={STYLES.container}>
        {/* Header — eyebrow + headline */}
        <div className={STYLES.headerWrap}>
          <Reveal variant="fadeIn" as="span" className={STYLES.eyebrow}>
            {COPY.eyebrow}
          </Reveal>
          <div className="overflow-hidden mt-2 pb-2">
            <motion.h2
              className={STYLES.headline}
              initial={prefersReduced ? undefined : { y: "100%" }}
              whileInView={{ y: "0%" }}
              viewport={{ once: true, margin: "-20%" }}
              transition={{ duration: 0.9, delay: 0.15, ease: [...E] }}
            >
              {COPY.headline}
            </motion.h2>
          </div>
        </div>

        {/* Cards — staggered with image clip-path wipes */}
        <motion.div
          className={STYLES.grid}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-20%" }}
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.14, delayChildren: 0.2 },
            },
          }}
        >
          {CARDS.map((card, i) => (
            <WhySolCard key={card.label} card={card} index={i} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
