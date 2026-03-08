"use client";

import { useState } from "react";
import Link from "next/link";
import { ScrollFadeIn } from "./ScrollFadeIn";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const charon = {
  badge: "BYOK",
  name: "Charon",
  tagline: "Bring your own keys. Zero markup.",
  tiers: [
    { name: "Shade", price: "Free", detail: "10K requests/mo" },
    { name: "Obol", price: "$29/mo", detail: "100K requests/mo" },
    { name: "Ferryman", price: "$99/mo", detail: "1M requests/mo" },
    { name: "Titan", price: "$499/mo", detail: "Unlimited requests" },
  ],
  cta: "Start for free",
  ctaType: "outline" as const,
};

const achilles = {
  badge: "MANAGED",
  name: "Achilles",
  tagline: "We handle everything. Just use credits.",
  tiers: [
    { name: "Spark", price: "$10/mo", detail: "10K credits included" },
    { name: "Blaze", price: "$50/mo", detail: "60K credits included" },
    { name: "Inferno", price: "$200/mo", detail: "300K credits included" },
  ],
  cta: "Get started",
  ctaType: "accent" as const,
};

function PricingCard({
  card,
  highlight,
  delay,
}: {
  card: typeof charon | typeof achilles;
  highlight?: boolean;
  delay: number;
}) {
  const [ctaHovered, setCtaHovered] = useState(false);

  return (
    <ScrollFadeIn delay={delay}>
      <div
        className="relative border rounded-[20px] p-10 hover:-translate-y-1 transition-all duration-300"
        style={{
          backgroundColor: "var(--lp-bg-card)",
          borderColor: highlight
            ? "rgba(124,58,237,0.3)"
            : "var(--lp-border)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = highlight
            ? "rgba(124,58,237,0.5)"
            : "var(--lp-border-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = highlight
            ? "rgba(124,58,237,0.3)"
            : "var(--lp-border)";
        }}
      >
        {highlight && (
          <span className="absolute top-6 right-6 bg-[rgba(124,58,237,0.15)] text-[#A78BFA] text-[11px] font-body rounded-full px-3 py-1">
            Popular
          </span>
        )}

        <p
          className="text-[11px] uppercase tracking-[3px] font-body mb-2"
          style={{ color: "var(--lp-text-muted)" }}
        >
          {card.badge}
        </p>
        <h3
          className="font-serif text-3xl font-bold mb-1"
          style={{ color: "var(--lp-text-primary)" }}
        >
          {card.name}
        </h3>
        <p className="text-sm font-body" style={{ color: "var(--lp-text-secondary)" }}>
          {card.tagline}
        </p>

        <div className="my-6" style={{ borderTop: "1px solid var(--lp-border)" }} />

        <div className="space-y-4 mb-8">
          {card.tiers.map((t) => (
            <div
              key={t.name}
              className="flex items-center justify-between font-body"
            >
              <span
                className="text-[15px] font-medium"
                style={{ color: "var(--lp-text-primary)" }}
              >
                {t.name}
              </span>
              <div className="flex items-center gap-4">
                <span className="text-[15px]" style={{ color: "var(--lp-text-secondary)" }}>
                  {t.price}
                </span>
                <span className="text-[13px]" style={{ color: "var(--lp-text-muted)" }}>
                  {t.detail}
                </span>
              </div>
            </div>
          ))}
        </div>

        <Link
          href={SKIP_AUTH ? "/overview" : "/register"}
          className="block w-full text-center rounded-full py-3.5 text-sm font-medium font-body transition-all duration-300"
          style={
            card.ctaType === "accent"
              ? {
                  backgroundColor: ctaHovered ? "var(--lp-accent-hover)" : "var(--lp-accent)",
                  color: "#FFFFFF",
                }
              : {
                  backgroundColor: "transparent",
                  color: "var(--lp-text-primary)",
                  border: "1px solid var(--lp-border-hover)",
                  ...(ctaHovered
                    ? { borderColor: "var(--lp-text-muted)", backgroundColor: "var(--lp-bg-card)" }
                    : {}),
                }
          }
          onMouseEnter={() => setCtaHovered(true)}
          onMouseLeave={() => setCtaHovered(false)}
        >
          {card.cta} &rarr;
        </Link>
      </div>
    </ScrollFadeIn>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-[1100px] mx-auto">
        <ScrollFadeIn>
          <p
            className="text-xs uppercase tracking-[4px] font-body mb-4"
            style={{ color: "var(--lp-text-muted)" }}
          >
            Pricing
          </p>
          <h2
            className="font-serif text-5xl font-bold mb-4"
            style={{ color: "var(--lp-text-primary)" }}
          >
            Simple, transparent pricing.
          </h2>
          <p
            className="text-lg max-w-[600px] mb-16 font-body"
            style={{ color: "var(--lp-text-secondary)" }}
          >
            Choose the mode that fits your workflow. Both modes work seamlessly with MCP and REST API.
          </p>
        </ScrollFadeIn>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PricingCard card={charon} delay={0} />
          <PricingCard card={achilles} highlight delay={0.2} />
        </div>
      </div>
    </section>
  );
}
