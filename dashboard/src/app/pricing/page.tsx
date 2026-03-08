"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Github, ArrowRight } from "lucide-react";
import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const GITHUB_URL = "https://github.com/timmx7/styx";

export default function PricingPage() {
  const router = useRouter();

  useEffect(() => {
    if (SKIP_AUTH) router.replace("/overview");
  }, [router]);

  return (
    <div className="relative min-h-screen bg-background font-body">
      <Navigation />

      <section className="relative min-h-[80vh] flex flex-col items-center justify-center px-6 text-center">
        {/* Subtle glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/5 blur-[120px] pointer-events-none rounded-full" />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 max-w-xl"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-8">
            <span className="text-[11px] font-body text-primary tracking-widest uppercase">Pricing</span>
          </div>

          <h1
            className="font-serif font-bold text-foreground mb-4 tracking-tight leading-none"
            style={{ fontSize: "clamp(40px, 6vw, 64px)" }}
          >
            Styx is free.
            <br />
            <span className="text-primary">Always.</span>
          </h1>

          <p className="text-base text-muted-foreground font-body font-light mb-10 leading-relaxed">
            Styx is open-source software licensed under Apache 2.0.
            There are no paid plans, no feature gates, and no usage limits.
            Self-host it on your own infrastructure in under 5 minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 bg-primary text-white rounded-full font-semibold text-[14px] hover:bg-primary/90 transition-all shadow-sm"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-medium text-[14px] text-foreground border border-border hover:bg-muted hover:border-primary/30 transition-all"
            >
              <Github className="w-4 h-4 text-muted-foreground" />
              View on GitHub
            </a>
          </div>

          <p className="mt-8 text-[12px] font-mono text-muted-foreground">
            Managed hosting coming soon →{" "}
            <a
              href="https://styx.app"
              className="hover:text-foreground transition-colors underline underline-offset-4"
            >
              styx.app
            </a>
          </p>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}
