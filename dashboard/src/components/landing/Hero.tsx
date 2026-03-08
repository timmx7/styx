"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Github, Zap } from "lucide-react";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const GITHUB_URL = "https://github.com/timmx7/styx";

const terminalLines = [
  { text: "$ git clone github.com/timmx7/styx && cd styx", delay: 0 },
  { text: "$ ./setup.sh", delay: 900 },
  { text: "✓ Provider keys configured (OpenAI + Anthropic)", delay: 1600 },
  { text: "✓ Secrets generated. .env written.", delay: 2200 },
  { text: "$ docker compose up -d --build", delay: 2900 },
  { text: "✓ 12 services healthy — dashboard at :3000", delay: 3800 },
];

function HeroTerminal() {
  const [visibleLines, setVisibleLines] = useState<number>(0);

  useEffect(() => {
    const timers = terminalLines.map((line, i) =>
      setTimeout(() => setVisibleLines(i + 1), line.delay + 600)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.5 }}
      className="w-full max-w-2xl mx-auto mt-14"
    >
      {/* Light card wrapper — dark terminal as editorial "code specimen" */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Cream header bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
          <span className="ml-3 text-[11px] font-mono text-muted-foreground tracking-wide">
            styx — setup
          </span>
        </div>

        {/* Dark terminal body */}
        <div className="bg-[#111111] p-5 font-mono text-[13px] sm:text-[14px] leading-relaxed min-h-[160px]">
          {terminalLines.slice(0, visibleLines).map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className={`${
                line.text.startsWith("✓")
                  ? "text-emerald-400"
                  : "text-neutral-200"
              } mb-1`}
            >
              {line.text}
            </motion.div>
          ))}
          {visibleLines < terminalLines.length && (
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="inline-block w-2 h-[14px] bg-primary/80 mt-1 align-middle"
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function Hero() {
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 500], [1, 0]);

  return (
    <section className="relative min-h-[100svh] flex flex-col items-center justify-center px-6 text-center overflow-hidden pt-28 pb-20">

      {/* Subtle radial glow in primary color for depth */}
      <motion.div
        style={{ opacity }}
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] max-w-[900px] h-[500px] bg-primary/5 blur-[120px] pointer-events-none rounded-full"
      />

      <div className="relative z-10 max-w-5xl mx-auto flex flex-col items-center">

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className="mb-8"
        >
          <div className="inline-flex items-center gap-2 bg-primary/8 border border-primary/20 rounded-full px-4 py-1.5">
            <Zap className="w-3 h-3 text-primary" />
            <span className="text-xs font-medium tracking-wide text-primary font-body">
              Apache 2.0 · Self-Hosted · Free Forever
            </span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
          className="font-serif font-extrabold tracking-tighter text-foreground mb-6"
          style={{ fontSize: "clamp(44px, 7vw, 96px)", lineHeight: "0.95" }}
        >
          The AI gateway your<br className="hidden md:block" />{" "}
          <span className="text-primary">team actually owns.</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 font-body font-light"
          style={{ lineHeight: "1.6" }}
        >
          Self-host in 5 minutes. Connect Claude, Cursor, or any MCP client to every AI provider.
          Your keys, your data, zero lock-in.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto"
        >
          <Link
            href={SKIP_AUTH ? "/overview" : "/docs/getting-started"}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-white rounded-full font-medium text-[15px] font-body hover:bg-primary/90 transition-colors shadow-sm"
          >
            Get started free
            <ArrowRight className="w-4 h-4" />
          </Link>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-full font-medium text-[15px] text-foreground border border-border hover:bg-muted hover:border-primary/30 transition-colors font-body"
          >
            <Github className="w-4 h-4 text-muted-foreground" />
            Star on GitHub
          </a>
        </motion.div>

        {/* Micro-copy */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
          className="mt-7 flex items-center justify-center gap-2 sm:gap-4 text-xs font-body text-muted-foreground flex-wrap"
        >
          <span>MCP Native</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span>Docker Compose</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span>BYOK — zero markup</span>
          <span className="w-1 h-1 rounded-full bg-border" />
          <span>OpenAI SDK compatible</span>
        </motion.div>

        {/* Terminal */}
        <HeroTerminal />
      </div>
    </section>
  );
}
