"use client";

import { motion } from "framer-motion";
import { Download, Link2, Monitor } from "lucide-react";
import { ScrollFadeIn } from "./ScrollFadeIn";

const steps = [
  {
    number: "01",
    icon: <Download className="w-5 h-5 text-primary" />,
    title: "Install in 5 minutes",
    description:
      "Run the interactive setup wizard. It checks prerequisites, collects your provider API keys, generates all secrets, and writes your .env. No Supabase account needed.",
    code: `$ git clone https://github.com/timmx7/styx
$ cd styx
$ ./setup.sh

  ✓ Docker 24+ detected
  ✓ Provider keys configured (OpenAI + Anthropic)
  ✓ Secrets generated
  ✓ .env written

$ docker compose up -d --build
  ✓ 12 services healthy`,
  },
  {
    number: "02",
    icon: <Link2 className="w-5 h-5 text-primary" />,
    title: "One line change",
    description:
      "Point your existing OpenAI SDK client at your local gateway. Every provider, every model — zero code changes beyond the base URL.",
    code: `# Before
client = OpenAI(api_key="sk-...")

# After — that's it
client = OpenAI(
  base_url="http://localhost:8080/v1",
  api_key="any-string"  # BYOK mode
)

# All existing calls work unchanged
response = client.chat.completions.create(
  model="gpt-4o",  # or claude-3-5-sonnet
  messages=[{"role": "user", "content": "hello"}]
)`,
  },
  {
    number: "03",
    icon: <Monitor className="w-5 h-5 text-primary" />,
    title: "Monitor everything",
    description:
      "Open the self-hosted dashboard for real-time token usage, cost per model, latency breakdown, and request logs. Set budget alerts before your first request.",
    code: `open http://localhost:3000

  ✓ Overview: 247 requests today
  ✓ Cost: $0.12 (↓38% vs direct)
  ✓ Cache hit rate: 34%
  ✓ Active providers: gpt-4o, claude-3-5-sonnet

  Budget: $5.00 / $10.00 this month
  Alert: 80% threshold → Slack webhook`,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-6 relative overflow-hidden bg-card border-y border-border">
      <div className="max-w-[1200px] mx-auto">

        {/* Section Header */}
        <div className="text-center mb-20 max-w-3xl mx-auto">
          <ScrollFadeIn>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/20 mb-6">
              <span className="text-[13px] font-medium tracking-wide text-primary uppercase font-body">
                3 Steps to Running
              </span>
            </div>
            <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold mb-6 tracking-tight text-foreground leading-tight">
              From clone to{" "}
              <span className="text-primary">production in minutes.</span>
            </h2>
            <p className="text-lg text-muted-foreground md:text-xl font-body font-light">
              No managed accounts. No SDK migrations. Just Docker Compose, your API keys, and one line change.
            </p>
          </ScrollFadeIn>
        </div>

        {/* Steps */}
        <div className="space-y-12 lg:space-y-16">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: [0.25, 0.1, 0.25, 1] }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center"
            >
              {/* Left: Text */}
              <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                <div className="flex items-center gap-4 mb-5">
                  {/* Step number — large Cinzel editorial style */}
                  <span className="font-serif text-5xl font-bold text-primary/20 leading-none select-none">
                    {step.number}
                  </span>
                  <div className="inline-flex p-2.5 rounded-xl bg-primary/8 border border-primary/15">
                    {step.icon}
                  </div>
                </div>
                <h3 className="font-serif text-2xl sm:text-3xl font-bold text-foreground mb-3 tracking-tight">
                  {step.title}
                </h3>
                <p className="text-[16px] leading-relaxed text-muted-foreground font-body font-light">
                  {step.description}
                </p>
              </div>

              {/* Right: Code block */}
              <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                <div className="bg-background border border-border rounded-2xl overflow-hidden shadow-sm">
                  {/* Light header */}
                  <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-card/60">
                    <div className="w-2 h-2 rounded-full bg-border" />
                    <div className="w-2 h-2 rounded-full bg-border" />
                    <div className="w-2 h-2 rounded-full bg-border" />
                    <span className="ml-2 text-[11px] font-mono text-muted-foreground">
                      step {step.number}
                    </span>
                  </div>
                  {/* Dark code body */}
                  <div className="bg-[#111111]">
                    <pre className="p-5 font-mono text-[13px] leading-relaxed text-neutral-300 overflow-x-auto">
                      <code>{step.code}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
