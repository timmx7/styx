"use client";

import { motion } from "framer-motion";
import { X, Check, Sparkles } from "lucide-react";
import { ScrollFadeIn } from "./ScrollFadeIn";

interface FeatureRow {
  label: string;
  without: string | boolean;
  withApi: string | boolean;
  withMcp: string | boolean;
}

const features: FeatureRow[] = [
  {
    label: "Setup complexity",
    without: "Multiple SDKs per provider",
    withApi: "Change one base URL",
    withMcp: "One CLI command",
  },
  {
    label: "Model switching",
    without: "Code changes per provider",
    withApi: "Change model parameter",
    withMcp: "Natural language",
  },
  { label: "Automatic fallback", without: false, withApi: true, withMcp: true },
  { label: "Semantic caching", without: false, withApi: true, withMcp: true },
  { label: "Real-time cost tracking", without: false, withApi: true, withMcp: true },
  { label: "Works with AI coding tools", without: false, withApi: false, withMcp: true },
  { label: "Zero code changes", without: false, withApi: "Minimal", withMcp: true },
  { label: "Tool discovery (MCP)", without: false, withApi: false, withMcp: true },
];

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) {
    return <Check className="w-5 h-5 text-primary mx-auto" />;
  }
  if (value === false) {
    return <X className="w-5 h-5 text-border mx-auto" />;
  }
  return <span className="text-[14px] text-muted-foreground font-body">{value}</span>;
}

export function Comparison() {
  return (
    <section className="py-24 px-6 relative overflow-hidden">
      <div className="max-w-[1100px] mx-auto">

        {/* Section Header */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <ScrollFadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-6">
              <span className="text-[13px] font-medium tracking-wide text-primary uppercase font-body">
                See the Difference
              </span>
            </div>
            <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold mb-6 tracking-tight text-foreground leading-tight">
              Why teams choose{" "}
              <span className="text-primary">Styx.</span>
            </h2>
          </ScrollFadeIn>
        </div>

        {/* Comparison Table */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative"
        >
          {/* Highlight behind MCP column */}
          <div className="absolute top-0 right-0 w-[33%] h-full bg-primary/3 rounded-r-2xl pointer-events-none hidden lg:block" />

          <div className="border border-border rounded-2xl overflow-hidden bg-card shadow-sm">
            {/* Header */}
            <div className="grid grid-cols-4 border-b border-border bg-background/50">
              <div className="p-5" />
              <div className="p-5 text-center border-l border-border">
                <p className="text-[11px] uppercase tracking-[3px] text-muted-foreground font-body mb-1">
                  Without Styx
                </p>
                <p className="text-[15px] font-medium text-muted-foreground font-body">
                  Direct API
                </p>
              </div>
              <div className="p-5 text-center border-l border-border">
                <p className="text-[11px] uppercase tracking-[3px] text-muted-foreground font-body mb-1">
                  Styx
                </p>
                <p className="text-[15px] font-medium text-foreground font-body">
                  REST API
                </p>
              </div>
              <div className="p-5 text-center border-l border-border relative">
                <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
                <div className="relative">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/25 mb-1">
                    <Sparkles className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[15px] font-semibold text-foreground font-body">
                    Styx MCP
                  </p>
                </div>
              </div>
            </div>

            {/* Rows */}
            {features.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-4 ${
                  i < features.length - 1 ? "border-b border-border" : ""
                } hover:bg-muted/40 transition-colors`}
              >
                <div className="p-4 sm:p-5 flex items-center">
                  <span className="text-[14px] font-medium text-foreground font-body">
                    {row.label}
                  </span>
                </div>
                <div className="p-4 sm:p-5 flex items-center justify-center border-l border-border text-center">
                  <CellValue value={row.without} />
                </div>
                <div className="p-4 sm:p-5 flex items-center justify-center border-l border-border text-center">
                  <CellValue value={row.withApi} />
                </div>
                <div className="p-4 sm:p-5 flex items-center justify-center border-l border-border text-center relative">
                  <div className="absolute inset-0 bg-primary/[0.03] pointer-events-none" />
                  <div className="relative">
                    <CellValue value={row.withMcp} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
