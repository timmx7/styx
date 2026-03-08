"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Plug, Shuffle, Key, BarChart3, AlertTriangle, Server } from "lucide-react";
import { ScrollFadeIn } from "./ScrollFadeIn";

interface FeatureCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
  delay?: number;
  accent?: string;
}

function FeatureCard({ title, description, icon, className = "", delay = 0, accent = "text-primary" }: FeatureCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={`group relative flex flex-col bg-card border border-border rounded-xl p-8 hover:border-primary/25 hover:shadow-sm transition-all duration-300 ${className}`}
    >
      {/* Top border accent on hover */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className={`mb-5 inline-flex p-3 rounded-xl bg-primary/8 border border-primary/15 ${accent} group-hover:bg-primary/12 transition-colors w-fit`}>
        {icon}
      </div>

      <h3 className="font-serif text-xl md:text-2xl font-semibold mb-3 tracking-tight text-foreground">
        {title}
      </h3>

      <p className="text-[15px] leading-relaxed text-muted-foreground font-body font-light">
        {description}
      </p>
    </motion.div>
  );
}

export function Features() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "center center"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.97, 1]);

  return (
    <section ref={sectionRef} id="features" className="py-24 px-6 relative overflow-hidden bg-background">
      <div className="max-w-[1200px] mx-auto">

        {/* Section Header */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <ScrollFadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-6">
              <Plug className="w-4 h-4 text-primary" />
              <span className="text-[13px] font-medium tracking-wide text-primary uppercase font-body">Why Styx</span>
            </div>
            <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold mb-6 tracking-tight text-foreground leading-tight">
              Built for the{" "}
              <span className="text-primary">MCP era.</span>
            </h2>
            <p className="text-lg text-muted-foreground md:text-xl font-body font-light">
              The first open-source AI gateway built for the Model Context Protocol. Every feature included, no tiers, no limits.
            </p>
          </ScrollFadeIn>
        </div>

        {/* Feature Grid — 2×3 bento */}
        <motion.div style={{ scale }} className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full">

          <FeatureCard
            title="MCP Native"
            description="The first AI gateway built for the Model Context Protocol. Claude, Cursor, Windsurf, and every MCP client connect natively — your tools discover models and route requests without a single line of integration code."
            icon={<Plug className="w-5 h-5" />}
            className="md:col-span-2"
            delay={0.1}
          />

          <FeatureCard
            title="BYOK"
            description="Bring Your Own Keys. Your API keys are encrypted at rest. You pay providers directly — zero markup, zero middleman, full cost control."
            icon={<Key className="w-5 h-5" />}
            delay={0.15}
          />

          <FeatureCard
            title="Universal Routing"
            description="OpenAI, Anthropic, Google, Mistral — one self-hosted gateway, one endpoint. Switch models by changing a string. Automatic failover keeps your app running."
            icon={<Shuffle className="w-5 h-5" />}
            delay={0.2}
          />

          <FeatureCard
            title="Full Visibility"
            description="Real-time dashboards for token usage, latency per model, cost breakdown, and request logs. See exactly where every dollar goes — open source and self-hosted."
            icon={<BarChart3 className="w-5 h-5" />}
            delay={0.25}
          />

          <FeatureCard
            title="Auto-Fallback"
            description="Circuit breakers monitor provider health. Failed or slow requests are retried on the next provider automatically — zero downtime even during outages."
            icon={<AlertTriangle className="w-5 h-5" />}
            delay={0.3}
          />

          <FeatureCard
            title="Fully Self-Hosted"
            description="Runs on Docker Compose in minutes. Your infrastructure, your data. No cloud dependency, no vendor lock-in, full data sovereignty. Apache 2.0 licensed — use it, fork it, build on it."
            icon={<Server className="w-5 h-5" />}
            className="md:col-span-3"
            delay={0.35}
          />

        </motion.div>
      </div>
    </section>
  );
}
