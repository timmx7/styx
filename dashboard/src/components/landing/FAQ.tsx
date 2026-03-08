"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollFadeIn } from "./ScrollFadeIn";

const faqs = [
  {
    q: "What is MCP?",
    a: "MCP (Model Context Protocol) is an open standard that lets AI tools like Claude Desktop, Cursor, and Windsurf connect to external services. Think of it as USB-C for AI — one protocol, every tool. Styx is an MCP server that gives these tools access to any AI model provider.",
  },
  {
    q: "How does Styx use MCP?",
    a: "Styx exposes AI model access as MCP tools. When you install the Styx MCP server, your AI tools automatically discover capabilities like chat completions, model listing, and model switching. Ask Claude to 'use GPT-4 for this' and Styx handles the routing.",
  },
  {
    q: "Can I still use the REST API?",
    a: "Absolutely. MCP is the recommended way to connect, but Styx also works as a standard OpenAI-compatible REST API. Just change your base URL to api.styx.sh/v1 and your existing code works instantly. Both connection methods get the same caching, fallbacks, and analytics.",
  },
  {
    q: "What is the difference between Charon and Achilles?",
    a: "Charon (BYOK) lets you use your own API keys and pay providers directly — Styx charges zero markup. Achilles (Managed) means Styx handles everything — you just buy credits and use any model instantly. Both work with MCP and REST API.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes. Charon's Shade plan is completely free with 10,000 requests per month. No credit card required. Install the MCP server and start using it immediately.",
  },
  {
    q: "Which AI tools support MCP?",
    a: "Claude Desktop, Cursor, Windsurf, Continue, and a growing ecosystem of MCP-compatible tools. Any tool that supports the Model Context Protocol can connect to Styx out of the box — no custom integrations needed.",
  },
  {
    q: "Is my data secure?",
    a: "All provider keys are encrypted with AES-256. Styx never stores your prompts or responses. Your data passes through and is never logged. The MCP server runs locally on your machine, so your API key never leaves your environment.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 px-6">
      <div className="max-w-[700px] mx-auto">
        <ScrollFadeIn>
          <h2
            className="font-serif text-5xl font-bold mb-12 text-center"
            style={{ color: "var(--lp-text-primary)" }}
          >
            Frequently asked questions.
          </h2>
        </ScrollFadeIn>

        <div>
          {faqs.map((faq, i) => (
            <ScrollFadeIn key={i} delay={i * 0.05}>
              <div className="border-b" style={{ borderColor: "var(--lp-border)" }}>
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full flex items-center justify-between py-6 text-left group"
                  onMouseEnter={(e) => {
                    const icon = e.currentTarget.querySelector<HTMLElement>("[data-toggle-icon]");
                    if (icon) icon.style.color = "var(--lp-text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    const icon = e.currentTarget.querySelector<HTMLElement>("[data-toggle-icon]");
                    if (icon) icon.style.color = "var(--lp-text-muted)";
                  }}
                >
                  <span
                    className="text-lg font-medium font-body pr-8"
                    style={{ color: "var(--lp-text-primary)" }}
                  >
                    {faq.q}
                  </span>
                  <span
                    data-toggle-icon
                    className="text-xl shrink-0 transition-colors"
                    style={{ color: "var(--lp-text-muted)" }}
                  >
                    {openIndex === i ? "\u2212" : "+"}
                  </span>
                </button>
                <AnimatePresence>
                  {openIndex === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <p
                        className="text-[15px] leading-[1.7] font-body pb-6"
                        style={{ color: "var(--lp-text-secondary)" }}
                      >
                        {faq.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollFadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
