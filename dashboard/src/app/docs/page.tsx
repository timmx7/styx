"use client";

import { Navigation } from "@/components/landing/Navigation";
import { Footer } from "@/components/landing/Footer";
import { Copy, Check, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sections: Section[] = [
  { id: "quickstart", title: "Quickstart" },
  { id: "authentication", title: "Authentication" },
  { id: "endpoints", title: "Endpoints" },
  { id: "smart-routing", title: "Smart Routing" },
  { id: "semantic-cache", title: "Semantic Cache" },
  { id: "budget-controls", title: "Budget Controls" },
  { id: "error-handling", title: "Error Handling" },
  { id: "sdk", title: "SDK" },
];

// ---------------------------------------------------------------------------
// Code block component — dark terminal style
// ---------------------------------------------------------------------------

function CodeBlock({
  code,
  language,
  filename,
}: {
  code: string;
  language: string;
  filename?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden my-6 bg-[#1a1a1a]">
      <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          {filename && (
            <span className="text-xs text-white/30">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30">{language}</span>
          <button
            onClick={handleCopy}
            className="transition-colors p-1 text-white/30 hover:text-white/60"
          >
            {copied ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      <div className="p-5 overflow-x-auto">
        <pre className="text-sm font-mono leading-relaxed text-white/70">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  activeSection,
  onSectionClick,
}: {
  activeSection: string;
  onSectionClick: (id: string) => void;
}) {
  return (
    <nav className="sticky top-32 space-y-1">
      <div className="text-xs uppercase tracking-widest mb-6 font-medium text-[#6b6560]">
        Documentation
      </div>
      {sections.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => onSectionClick(section.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 ${
              isActive
                ? "bg-[#1400FF]/[0.06] text-[#1a1a1a] font-medium"
                : "text-[#6b6560] hover:text-[#1a1a1a] hover:bg-black/[0.03]"
            }`}
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${
                isActive ? "rotate-90 text-[#1400FF]" : ""
              }`}
            />
            {section.title}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Reusable components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-3xl md:text-4xl mb-6 scroll-mt-36 font-normal tracking-tight text-[#1a1a1a]">
      {children}
    </h2>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded text-xs font-mono whitespace-nowrap bg-[#eae4dc] text-[#1a1a1a]">
      {children}
    </code>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-[#1400FF] text-white">
          {number}
        </div>
      </div>
      <div className="flex-1 pt-0.5">
        <h3 className="font-medium text-lg mb-2 text-[#1a1a1a]">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function EndpointBlock({
  method,
  path,
  description,
  requestCode,
  responseCode,
}: {
  method: string;
  path: string;
  description: string;
  requestCode: string;
  responseCode: string;
}) {
  return (
    <div className="mb-12">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-mono px-2.5 py-1 rounded-full font-medium bg-[#1400FF] text-white">
          {method}
        </span>
        <code className="font-mono text-sm text-[#1a1a1a]">{path}</code>
      </div>
      <p className="text-sm mb-4 leading-relaxed text-[#6b6560]">
        {description}
      </p>
      <CodeBlock language="json" filename="Request body" code={requestCode} />
      <CodeBlock language="json" filename="Response" code={responseCode} />
    </div>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#d6d0c8] p-6 my-6 bg-white/40">
      <h4 className="font-medium mb-3 text-[#1a1a1a]">{title}</h4>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("quickstart");

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections.map((s) => ({
        id: s.id,
        el: document.getElementById(s.id),
      }));

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const el = sectionElements[i].el;
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 160) {
            setActiveSection(sectionElements[i].id);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const yOffset = -140;
      const y = el.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    setActiveSection(id);
  };

  return (
    <div
      className="min-h-screen font-sans"
      style={{ backgroundColor: "#f5f0eb", color: "#1a1a1a" }}
    >
      <Navigation />

      {/* Header */}
      <section className="relative pt-32 pb-12 px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Thin line + label */}
          <div className="border-t border-[#d6d0c8] pt-8 mb-8">
            <span className="uppercase text-sm font-medium tracking-widest text-[#6b6560]">
              Reference
            </span>
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-serif text-5xl md:text-6xl font-normal tracking-tight text-[#1a1a1a] mb-4"
          >
            Documentation
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg max-w-2xl text-[#6b6560] leading-relaxed"
          >
            Everything you need to integrate Styx into your application. Go from
            zero to production in minutes.
          </motion.p>
        </div>
      </section>

      {/* Content */}
      <section className="px-6 lg:px-8 pb-28">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-12">
            {/* Sidebar */}
            <div className="hidden lg:block">
              <Sidebar
                activeSection={activeSection}
                onSectionClick={scrollToSection}
              />
            </div>

            {/* Main content */}
            <div className="min-w-0">
              {/* QUICKSTART */}
              <div id="quickstart" className="mb-20">
                <SectionHeading>Quickstart</SectionHeading>
                <p className="leading-relaxed mb-8 text-[#6b6560]">
                  Get up and running with Styx in three simple steps. No complex
                  setup required.
                </p>

                <div className="space-y-8">
                  <Step number={1} title="Sign up and create a project">
                    <p className="text-sm leading-relaxed text-[#6b6560]">
                      Create a free account at{" "}
                      <Link
                        href="/login"
                        className="underline underline-offset-4 text-[#1400FF]"
                      >
                        app.styx.ai
                      </Link>{" "}
                      and create your first project from the dashboard. Each
                      project gets its own usage tracking and budget controls.
                    </p>
                  </Step>

                  <Step number={2} title="Get your API key">
                    <p className="text-sm leading-relaxed text-[#6b6560]">
                      Navigate to the{" "}
                      <span className="font-medium text-[#1a1a1a]">
                        API Keys
                      </span>{" "}
                      page and generate a new key. Copy it somewhere safe
                      &mdash; you will not be able to see it again.
                    </p>
                  </Step>

                  <Step number={3} title="Make your first API call">
                    <p className="text-sm leading-relaxed mb-4 text-[#6b6560]">
                      Replace your existing OpenAI base URL with the Styx
                      gateway. That is it &mdash; your existing code works
                      without changes.
                    </p>
                    <CodeBlock
                      language="python"
                      filename="quickstart.py"
                      code={`from openai import OpenAI

# Just change the base URL — everything else stays the same
client = OpenAI(
    api_key="your-styx-api-key",
    base_url="https://api.styx.ai/v1"  # production
    # base_url="http://localhost:8080/v1"  # local dev
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "Hello, world!"}
    ]
)

print(response.choices[0].message.content)`}
                    />
                    <CodeBlock
                      language="bash"
                      filename="terminal"
                      code={`curl https://api.styx.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer your-styx-api-key" \\
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello, world!"}
    ]
  }'`}
                    />
                  </Step>
                </div>
              </div>

              {/* AUTHENTICATION */}
              <div id="authentication" className="mb-20">
                <SectionHeading>Authentication</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  All API requests to Styx require authentication via an API
                  key. Your key is sent as a Bearer token in the{" "}
                  <InlineCode>Authorization</InlineCode> header.
                </p>
                <CodeBlock
                  language="http"
                  code={`Authorization: Bearer styx_live_abc123def456...`}
                />

                <InfoCard title="Key types">
                  <ul className="space-y-3 text-sm text-[#6b6560]">
                    <li className="flex gap-3">
                      <InlineCode>styx_live_*</InlineCode>
                      <span>
                        Production key. Requests are billed and count toward
                        your quota.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <InlineCode>styx_test_*</InlineCode>
                      <span>
                        Test key. Requests are free but limited to 100/day.
                        Responses may be mocked.
                      </span>
                    </li>
                  </ul>
                </InfoCard>

                <p className="text-sm leading-relaxed text-[#6b6560]">
                  API keys are scoped to a project. You can create multiple keys
                  per project and revoke them individually from the dashboard.
                  Keys are hashed at rest and never stored in plain text.
                </p>
              </div>

              {/* ENDPOINTS */}
              <div id="endpoints" className="mb-20">
                <SectionHeading>Endpoints</SectionHeading>
                <p className="leading-relaxed mb-8 text-[#6b6560]">
                  Styx mirrors the OpenAI API surface. If you are using the
                  OpenAI SDK, you only need to change the base URL.
                </p>

                <EndpointBlock
                  method="POST"
                  path="/v1/chat/completions"
                  description="Generate a chat completion. Supports streaming via SSE."
                  requestCode={`{
  "model": "gpt-4",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain quantum computing."}
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}`}
                  responseCode={`{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum computing uses qubits..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 150,
    "total_tokens": 170
  }
}`}
                />

                <EndpointBlock
                  method="POST"
                  path="/v1/embeddings"
                  description="Create vector embeddings for text."
                  requestCode={`{
  "model": "text-embedding-3-small",
  "input": "The quick brown fox jumps over the lazy dog."
}`}
                  responseCode={`{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0094, 0.0151, ...]
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {
    "prompt_tokens": 10,
    "total_tokens": 10
  }
}`}
                />

                <EndpointBlock
                  method="POST"
                  path="/v1/completions"
                  description="Generate a text completion (legacy endpoint)."
                  requestCode={`{
  "model": "gpt-3.5-turbo-instruct",
  "prompt": "Write a haiku about programming:",
  "max_tokens": 50,
  "temperature": 0.9
}`}
                  responseCode={`{
  "id": "cmpl-abc123",
  "object": "text_completion",
  "created": 1700000000,
  "model": "gpt-3.5-turbo-instruct",
  "choices": [
    {
      "text": "\\nSilent keystrokes flow\\nLogic weaves through endless lines\\nBugs hide in the dark",
      "index": 0,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 8,
    "completion_tokens": 20,
    "total_tokens": 28
  }
}`}
                />
              </div>

              {/* SMART ROUTING */}
              <div id="smart-routing" className="mb-20">
                <SectionHeading>Smart Routing</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  Styx analyzes every incoming request and routes it to the
                  optimal AI provider based on complexity, cost, and latency.
                  You can override the routing decision by specifying a model
                  explicitly.
                </p>

                <InfoCard title="How classification works">
                  <div className="space-y-4 text-sm leading-relaxed text-[#6b6560]">
                    <p>
                      The classifier assigns a complexity score (0-1) to every
                      prompt using a combination of heuristics and a lightweight
                      ML model:
                    </p>
                    <ul className="space-y-2 ml-4">
                      <li className="flex gap-3">
                        <span className="font-medium text-[#1a1a1a] shrink-0">
                          0.0 - 0.3
                        </span>
                        Simple tasks (translation, formatting, short Q&amp;A)
                        routed to fast, cheap models like GPT-3.5 Turbo or
                        Mistral Small.
                      </li>
                      <li className="flex gap-3">
                        <span className="font-medium text-[#1a1a1a] shrink-0">
                          0.3 - 0.7
                        </span>
                        Medium complexity (summarization, analysis, code
                        generation) routed to GPT-4o or Claude Sonnet.
                      </li>
                      <li className="flex gap-3">
                        <span className="font-medium text-[#1a1a1a] shrink-0">
                          0.7 - 1.0
                        </span>
                        High complexity (multi-step reasoning, creative writing,
                        research) routed to GPT-4 or Claude Opus.
                      </li>
                    </ul>
                  </div>
                </InfoCard>

                <p className="text-sm leading-relaxed mb-4 text-[#6b6560]">
                  The response includes routing metadata in headers:
                </p>
                <CodeBlock
                  language="http"
                  code={`X-Styx-Provider: openai
X-Styx-Model: gpt-4
X-Styx-Complexity: 0.82
X-Styx-Latency: 1240ms`}
                />
              </div>

              {/* SEMANTIC CACHE */}
              <div id="semantic-cache" className="mb-20">
                <SectionHeading>Semantic Cache</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  Styx uses vector embeddings to detect semantically similar
                  requests. When a match is found, the cached response is
                  returned instantly without calling the upstream provider.
                </p>

                <InfoCard title="Cache headers">
                  <div className="space-y-3 text-sm">
                    <div className="flex gap-4">
                      <InlineCode>X-Styx-Cache</InlineCode>
                      <span className="text-[#6b6560]">
                        <InlineCode>HIT</InlineCode> or{" "}
                        <InlineCode>MISS</InlineCode> &mdash; whether the
                        response came from cache.
                      </span>
                    </div>
                    <div className="flex gap-4">
                      <InlineCode>X-Styx-Cache-Score</InlineCode>
                      <span className="text-[#6b6560]">
                        Similarity score (0-1). Responses with a score above
                        0.95 are considered a match.
                      </span>
                    </div>
                  </div>
                </InfoCard>

                <p className="text-sm leading-relaxed mb-4 text-[#6b6560]">
                  Example cached response headers:
                </p>
                <CodeBlock
                  language="http"
                  code={`HTTP/1.1 200 OK
X-Styx-Cache: HIT
X-Styx-Cache-Score: 0.98
X-Styx-Latency: 2ms
Content-Type: application/json`}
                />
                <p className="text-sm leading-relaxed text-[#6b6560]">
                  Cache is enabled by default on Pro and Enterprise plans. You
                  can disable it per-request by setting the{" "}
                  <InlineCode>X-Styx-Cache: SKIP</InlineCode> header.
                </p>
              </div>

              {/* BUDGET CONTROLS */}
              <div id="budget-controls" className="mb-20">
                <SectionHeading>Budget Controls</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  Set spending limits per project, per team, or per billing
                  cycle. Styx tracks spend in real-time using Redis counters.
                </p>

                <InfoCard title="Budget configuration">
                  <ul className="space-y-3 text-sm leading-relaxed text-[#6b6560]">
                    <li>
                      <span className="font-medium text-[#1a1a1a]">
                        Hard limit
                      </span>{" "}
                      &mdash; When exceeded, Styx returns a{" "}
                      <InlineCode>429</InlineCode> error and blocks all further
                      requests until the next billing cycle.
                    </li>
                    <li>
                      <span className="font-medium text-[#1a1a1a]">
                        Soft limit
                      </span>{" "}
                      &mdash; Triggers an alert (email, Slack, or webhook) but
                      allows requests to continue.
                    </li>
                    <li>
                      <span className="font-medium text-[#1a1a1a]">
                        Alerts
                      </span>{" "}
                      &mdash; Configurable thresholds at 50%, 80%, and 100% of
                      budget.
                    </li>
                  </ul>
                </InfoCard>

                <p className="text-sm leading-relaxed mb-4 text-[#6b6560]">
                  When a budget is exceeded:
                </p>
                <CodeBlock
                  language="json"
                  filename="429 response"
                  code={`{
  "error": {
    "type": "budget_exceeded",
    "message": "Project 'my-app' has exceeded its monthly budget of $100.00. Current spend: $100.42.",
    "code": "budget_exceeded",
    "project_id": "proj_abc123"
  }
}`}
                />
              </div>

              {/* ERROR HANDLING */}
              <div id="error-handling" className="mb-20">
                <SectionHeading>Error Handling</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  All errors follow a consistent JSON format. The HTTP status
                  code matches the error type.
                </p>
                <CodeBlock
                  language="json"
                  code={`{
  "error": {
    "type": "invalid_request",
    "message": "The 'model' field is required.",
    "code": "missing_field",
    "param": "model"
  }
}`}
                />

                <div className="my-8 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#d6d0c8]">
                        <th className="text-left py-3 pr-6 font-medium text-[#1a1a1a]">
                          Status
                        </th>
                        <th className="text-left py-3 pr-6 font-medium text-[#1a1a1a]">
                          Code
                        </th>
                        <th className="text-left py-3 font-medium text-[#1a1a1a]">
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[#6b6560]">
                      {[
                        [
                          "400",
                          "invalid_request",
                          "The request body is malformed or missing required fields.",
                        ],
                        [
                          "401",
                          "invalid_api_key",
                          "The API key is missing, invalid, or revoked.",
                        ],
                        [
                          "403",
                          "project_suspended",
                          "The project has been suspended by an admin.",
                        ],
                        [
                          "429",
                          "rate_limited",
                          "Too many requests. Retry after the time in Retry-After header.",
                        ],
                        [
                          "429",
                          "budget_exceeded",
                          "The project has exceeded its spending budget.",
                        ],
                        [
                          "502",
                          "provider_error",
                          "The upstream AI provider returned an error.",
                        ],
                        [
                          "503",
                          "all_providers_down",
                          "All configured providers are unavailable. Retry later.",
                        ],
                      ].map(([status, code, desc], i) => (
                        <tr
                          key={i}
                          className="border-b last:border-0 border-[#d6d0c8]/50"
                        >
                          <td className="py-3 pr-6">
                            <InlineCode>{status}</InlineCode>
                          </td>
                          <td className="py-3 pr-6 font-mono text-xs">
                            {code}
                          </td>
                          <td className="py-3">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SDK */}
              <div id="sdk" className="mb-20">
                <SectionHeading>SDK</SectionHeading>
                <p className="leading-relaxed mb-6 text-[#6b6560]">
                  The official Python SDK provides a convenient wrapper around
                  the Styx API with built-in retry logic and type hints.
                </p>

                <CodeBlock
                  language="bash"
                  filename="terminal"
                  code={`pip install styx-ai`}
                />

                <CodeBlock
                  language="python"
                  filename="example.py"
                  code={`from styx_ai import Styx

client = Styx(api_key="styx_live_abc123...")

# Chat completion (same interface as OpenAI)
response = client.chat.completions.create(
    model="auto",  # let Styx pick the best model
    messages=[
        {"role": "user", "content": "Summarize this article..."}
    ],
    temperature=0.5
)

print(response.choices[0].message.content)

# Access routing metadata
print(f"Provider: {response.styx_provider}")   # e.g. "anthropic"
print(f"Model: {response.styx_model}")          # e.g. "claude-3-sonnet"
print(f"Cached: {response.styx_cache_hit}")     # True/False
print(f"Latency: {response.styx_latency_ms}ms") # e.g. 820`}
                />

                <InfoCard title="SDK features">
                  <ul className="space-y-2 text-sm text-[#6b6560]">
                    {[
                      "Drop-in OpenAI SDK replacement",
                      "Automatic retries with exponential backoff",
                      "Streaming support (SSE)",
                      "Full type hints and IDE autocomplete",
                    ].map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check
                          className="w-4 h-4 shrink-0 mt-0.5 text-[#1400FF]"
                          strokeWidth={2.5}
                        />
                        {feature}
                      </li>
                    ))}
                    <li className="flex items-start gap-2">
                      <Check
                        className="w-4 h-4 shrink-0 mt-0.5 text-[#1400FF]"
                        strokeWidth={2.5}
                      />
                      Async support via{" "}
                      <InlineCode>styx_ai.AsyncStyx</InlineCode>
                    </li>
                  </ul>
                </InfoCard>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
