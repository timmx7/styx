"use client";

import Marquee from "react-fast-marquee";

const providers = ["OpenAI", "Anthropic", "Google", "Mistral", "Cohere", "Meta", "Perplexity"];

export function ProviderMarquee() {
  return (
    <section className="py-12 relative overflow-hidden border-y border-border bg-card">
      <p className="text-center text-[11px] uppercase tracking-[0.3em] font-medium font-body text-muted-foreground mb-8">
        Native Support for Leading Models
      </p>

      <div className="relative flex">
        {/* Left fade */}
        <div className="absolute left-0 top-0 bottom-0 w-24 z-20 pointer-events-none bg-gradient-to-r from-card to-transparent" />

        <Marquee speed={40} gradient={false} className="py-2">
          {[...providers, ...providers, ...providers].map((name, i) => (
            <span
              key={i}
              className="text-lg font-serif mx-8 sm:mx-12 text-muted-foreground hover:text-foreground transition-colors cursor-default"
            >
              {name}
              <span className="ml-8 sm:ml-12 text-border">&middot;</span>
            </span>
          ))}
        </Marquee>

        {/* Right fade */}
        <div className="absolute right-0 top-0 bottom-0 w-24 z-20 pointer-events-none bg-gradient-to-l from-card to-transparent" />
      </div>
    </section>
  );
}
