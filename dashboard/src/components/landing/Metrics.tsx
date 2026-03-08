"use client";

import { ScrollFadeIn } from "./ScrollFadeIn";
import { Counter } from "./Counter";

const metrics = [
  { end: 1.2, suffix: "M", label: "Total Requests", decimals: 1 },
  { end: 124, suffix: "ms", label: "Average Latency", decimals: 0 },
  { end: 99.9, suffix: "%", label: "Uptime Guarantee", decimals: 1 },
];

export function Metrics() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-[1100px] mx-auto text-center">
        <ScrollFadeIn>
          <h2
            className="font-serif text-5xl font-bold mb-4"
            style={{ color: "var(--lp-text-primary)" }}
          >
            Built for scale
          </h2>
          <p
            className="text-lg max-w-[600px] mx-auto mb-16 font-body"
            style={{ color: "var(--lp-text-secondary)" }}
          >
            Everything you need to build, deploy, and scale AI-powered
            applications with confidence.
          </p>
        </ScrollFadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {metrics.map((m, i) => (
            <ScrollFadeIn key={m.label} delay={i * 0.15}>
              <div className="text-center">
                <p
                  className="font-serif text-6xl font-bold mb-2"
                  style={{ color: "var(--lp-text-primary)" }}
                >
                  <Counter
                    end={m.end}
                    suffix={m.suffix}
                    decimals={m.decimals}
                  />
                </p>
                <p className="text-sm font-body" style={{ color: "var(--lp-text-muted)" }}>
                  {m.label}
                </p>
              </div>
            </ScrollFadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
