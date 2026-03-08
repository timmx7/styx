"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const companies = [
  { name: "Nextera", className: "font-sans font-bold tracking-tight text-xl" },
  {
    name: "MERIDIAN",
    className: "font-sans font-light tracking-[0.35em] text-xs",
  },
  {
    name: "vertex.ai",
    className: "font-mono font-normal text-base",
  },
  {
    name: "ARCHON",
    className: "font-sans font-black tracking-[0.2em] text-sm",
  },
  { name: "Luminary", className: "font-serif italic text-xl" },
  {
    name: "polymath",
    className: "font-sans font-medium tracking-tight text-lg lowercase",
  },
];

export function TrustedBy() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="py-20 px-6 bg-[#f5f0eb]">
      <div className="max-w-5xl mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* Label */}
          <p className="text-center text-sm font-sans text-[#6b6560] mb-12 uppercase tracking-widest">
            Trusted by teams at
          </p>

          {/* Logo grid */}
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
            {companies.map((company, i) => (
              <motion.span
                key={company.name}
                initial={{ opacity: 0, y: 10 }}
                animate={
                  isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }
                }
                transition={{
                  duration: 0.5,
                  delay: i * 0.08,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
                className={`${company.className} text-[#1a1a1a] opacity-30 hover:opacity-60 transition-opacity cursor-default select-none`}
              >
                {company.name}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
