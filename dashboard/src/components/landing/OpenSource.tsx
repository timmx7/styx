"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { ScrollFadeIn } from "./ScrollFadeIn";

const GITHUB_URL = "https://github.com/timmx7/styx";
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const pillars = [
  {
    badge: "LICENSE",
    title: "Apache 2.0",
    tagline: "Use it. Fork it. Build on it.",
    description:
      "No CLAs, no commercial restrictions, no feature gates. The full gateway — every feature — for everyone, forever.",
    accentClass: "text-amber-600 bg-amber-50 border-amber-200",
  },
  {
    badge: "DEPLOY",
    title: "Self-Hosted",
    tagline: "Your server. Your data.",
    description:
      "Runs on Docker Compose in 5 minutes. Zero external dependencies, zero vendor lock-in, full data sovereignty.",
    accentClass: "text-sky-600 bg-sky-50 border-sky-200",
  },
  {
    badge: "KEYS",
    title: "BYOK",
    tagline: "Bring your own API keys.",
    description:
      "Your provider keys are encrypted at rest. You pay OpenAI, Anthropic, and Google directly — zero markup, zero middleman.",
    accentClass: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
];

export function OpenSource() {
  return (
    <section id="open-source" className="py-24 px-6 relative overflow-hidden bg-background">
      <div className="max-w-[1200px] mx-auto">

        {/* Section Header */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <ScrollFadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-6">
              <span className="text-[13px] font-medium tracking-wide text-primary uppercase font-body">
                Open Source
              </span>
            </div>
            <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold mb-6 tracking-tight text-foreground leading-tight">
              Free.{" "}
              <span className="text-primary">Forever.</span>
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground font-body font-light">
              No paid tiers, no usage limits, no lock-in. Styx is open source and always will be.
            </p>
          </ScrollFadeIn>
        </div>

        {/* Pillar cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
          {pillars.map((pillar, i) => (
            <ScrollFadeIn key={pillar.title} delay={i * 0.1}>
              <div className="group relative flex flex-col bg-card border border-border rounded-xl p-8 hover:border-primary/25 hover:shadow-sm transition-all duration-300">
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity" />

                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium uppercase tracking-[2px] border ${pillar.accentClass} mb-4 w-fit font-body`}>
                  {pillar.badge}
                </div>

                <h3 className="font-serif text-3xl font-bold mb-1 text-foreground">
                  {pillar.title}
                </h3>
                <p className="text-sm mb-5 font-body text-muted-foreground">
                  {pillar.tagline}
                </p>

                <div className="h-px bg-border mb-5" />

                <p className="text-sm leading-relaxed font-body text-muted-foreground">
                  {pillar.description}
                </p>
              </div>
            </ScrollFadeIn>
          ))}
        </div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-8 py-3.5 rounded-full font-medium text-[15px] font-body bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Github className="w-4 h-4" />
            ⭐ Star on GitHub
          </a>
          <Link
            href={SKIP_AUTH ? "/overview" : "/docs/getting-started"}
            className="flex items-center gap-2 px-8 py-3.5 rounded-full font-medium text-[15px] font-body border border-border text-foreground hover:bg-muted hover:border-primary/30 transition-colors"
          >
            Read the docs
          </Link>
        </motion.div>


      </div>
    </section>
  );
}
