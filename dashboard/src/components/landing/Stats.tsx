"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const stats = [
  { value: "+40%", label: "Cost reduction" },
  { value: "<10ms", label: "Added latency" },
  { value: "99.99%", label: "Uptime SLA" },
  { value: "10K", label: "Free requests/mo" },
];

const metrics = [
  { label: "Requests/sec", value: "2,847", percent: 72 },
  { label: "Avg latency", value: "8.2ms", percent: 15 },
  { label: "Cache hit rate", value: "73.4%", percent: 73 },
  { label: "Cost saved today", value: "$1,240", percent: 89 },
];

export function Stats() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24 px-6 bg-[#f5f0eb]">
      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Thin line + label */}
        <div className="border-t border-[#d6d0c8] pt-8 mb-16">
          <span className="uppercase text-sm font-medium tracking-widest text-[#6b6560]">
            By the numbers
          </span>
        </div>

        {/* Stats grid */}
        <div ref={ref} className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{
                duration: 0.7,
                delay: i * 0.15,
                ease: [0.25, 0.1, 0.25, 1],
              }}
            >
              <p className="font-serif text-5xl md:text-6xl font-normal text-[#1a1a1a]">
                {stat.value}
              </p>
              <p className="font-sans text-sm text-[#6b6560] mt-3">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Description + Terminal mockup */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{
              duration: 0.7,
              delay: 0.7,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            className="font-sans text-lg text-[#6b6560]"
          >
            Built for teams that need reliability at scale. Every request routed
            through the fastest available path.
          </motion.p>

          {/* Terminal metrics mockup */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{
              duration: 0.7,
              delay: 0.85,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            className="bg-[#1a1a1a] rounded-xl p-6 font-mono text-sm"
          >
            {/* Terminal header */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="text-white/30 text-xs ml-2">
                styx — live metrics
              </span>
            </div>

            {/* Metrics rows */}
            <div className="space-y-3">
              {metrics.map((m, i) => (
                <div key={m.label} className="flex items-center gap-3">
                  <span className="text-white/40 w-28 text-xs shrink-0">
                    {m.label}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: "#1400FF" }}
                      initial={{ width: 0 }}
                      animate={
                        isInView ? { width: `${m.percent}%` } : { width: 0 }
                      }
                      transition={{
                        duration: 1,
                        delay: 1 + i * 0.15,
                        ease: [0.25, 0.1, 0.25, 1],
                      }}
                    />
                  </div>
                  <span className="text-white/70 text-xs w-16 text-right shrink-0">
                    {m.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Status line */}
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#28c840] animate-pulse" />
                <span className="text-[#28c840] text-xs">
                  All systems operational
                </span>
              </div>
              <span className="text-white/20 text-xs">Updated 2s ago</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
