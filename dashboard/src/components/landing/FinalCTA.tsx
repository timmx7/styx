"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Github, Copy, Check } from "lucide-react";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const GITHUB_URL = "https://github.com/timmx7/styx";
const QUICK_START = `git clone ${GITHUB_URL} && cd styx && ./setup.sh`;

function QuickStartBlock() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(QUICK_START);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-xl mx-auto mb-10">
      {/* Cream wrapper card, dark code inside */}
      <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/60">
          <span className="text-[11px] font-mono text-muted-foreground">quick start</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? (
              <><Check className="w-3 h-3 text-primary" /><span className="text-primary">copied</span></>
            ) : (
              <><Copy className="w-3 h-3" />copy</>
            )}
          </button>
        </div>
        <div className="bg-[#111111] px-4 py-3 font-mono text-[13px] text-neutral-300 overflow-x-auto whitespace-nowrap">
          <span className="text-neutral-500 select-none mr-1">$</span>
          {QUICK_START}
        </div>
      </div>
    </div>
  );
}

export function FinalCTA() {
  return (
    <section className="relative py-32 px-6 text-center overflow-hidden bg-card border-t border-border">

      {/* Very subtle blue glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/5 blur-[100px] pointer-events-none rounded-full" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative max-w-3xl mx-auto"
      >
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-8">
          <span className="text-[13px] font-medium text-primary uppercase tracking-wide font-body">
            Get Started
          </span>
        </div>

        <h2
          className="font-serif font-extrabold tracking-tight mb-6 text-foreground"
          style={{ fontSize: "clamp(40px, 6vw, 72px)", lineHeight: "1" }}
        >
          Ready to{" "}
          <span className="text-primary">ship?</span>
        </h2>

        <p className="text-lg md:text-xl max-w-2xl mx-auto mb-10 font-body font-light text-muted-foreground">
          Clone the repo, run the setup wizard, and have a self-hosted AI gateway running in under 5 minutes.
          Open source, Apache 2.0, free forever.
        </p>

        <QuickStartBlock />

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
          {/* Primary CTA */}
          <Link
            href={SKIP_AUTH ? "/overview" : "/docs/getting-started"}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-10 py-4 bg-primary text-white rounded-full font-bold text-[16px] font-body hover:bg-primary/90 active:scale-95 transition-all shadow-sm"
          >
            Get started free
            <ArrowRight className="w-4 h-4" />
          </Link>

          {/* GitHub CTA */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-10 py-4 rounded-full font-medium text-[16px] font-body text-foreground border border-border hover:bg-muted hover:border-primary/30 transition-all"
          >
            <Github className="w-5 h-5 text-muted-foreground" />
            ⭐ Star on GitHub
          </a>
        </div>

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground font-body flex-wrap">
          <span>Apache 2.0</span>
          <span className="w-1 h-1 rounded-full bg-border mx-1" />
          <span>Self-hosted</span>
          <span className="w-1 h-1 rounded-full bg-border mx-1" />
          <span>MCP + REST API</span>
        </div>
      </motion.div>
    </section>
  );
}
