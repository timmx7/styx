"use client";

import { useEffect, useState } from "react";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { CheckCircle2 } from "lucide-react";

const checks = [
  "Works with Claude Desktop, Cursor, Windsurf",
  "Zero-downtime fallback across providers",
  "Semantic caching saves up to 80% on costs",
  "Drop-in replacement for any OpenAI SDK",
];

const codeLines = [
  "import { OpenAI } from 'openai';",
  "",
  "// Point any OpenAI SDK to Styx — that's it.",
  "const client = new OpenAI({",
  "  baseURL: 'https://api.styx.sh/v1',",
  "  apiKey: process.env.STYX_API_KEY,",
  "});",
  "",
  "// All requests are now cached, monitored, and protected.",
  "const response = await client.chat.completions.create({",
  "  model: 'gpt-4o',  // or 'claude-3-opus', 'gemini-pro'...",
  "  messages: [{ role: 'user', content: 'Hello Styx!' }]",
  "});",
];

export function CodeExample() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);

  useEffect(() => {
    if (!isInView) return;

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < codeLines.length) {
        const line = codeLines[currentIndex];
        setDisplayedLines((prev) => [...prev, line]);
        currentIndex++;
      } else {
        clearInterval(interval);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [isInView]);

  return (
    <section className="py-32 px-6 relative z-10 overflow-hidden">
      <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">

        {/* Left column: Value Proposition */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6 text-cyan-400">
            <span className="text-[13px] font-medium tracking-wide uppercase">REST API Also Supported</span>
          </div>
          <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold mb-6 tracking-tight text-white leading-[1.1]">
            Already using the<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              OpenAI SDK?
            </span>
          </h2>
          <p className="text-lg md:text-xl text-white/60 font-light mb-10 leading-relaxed">
            Change one line. Your existing code works instantly with Styx — unlocking caching, fallbacks, and multi-provider routing with zero refactoring.
          </p>

          <ul className="space-y-4">
            {checks.map((c, i) => (
              <motion.li
                key={c}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 + 0.3 }}
                className="flex items-center gap-3 text-[16px] text-white/80"
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                {c}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        {/* Right column: Animated Terminal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          ref={ref}
          className="relative"
        >
          {/* Terminal Glow Effect */}
          <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/30 to-purple-500/30 blur-2xl rounded-[32px] opacity-70" />

          <div className="relative border border-white/10 rounded-2xl overflow-hidden bg-[#0d0d0d] shadow-2xl">
            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="text-[13px] font-mono text-white/40 flex items-center gap-2">
                src/index.ts
              </div>
              <div className="w-12" />
            </div>

            {/* Terminal Body with Animated Typewriter parsing */}
            <div className="p-4 sm:p-6 font-mono text-[13px] sm:text-[14px] leading-relaxed overflow-x-auto h-[300px] sm:h-[340px]">
              <div className="flex flex-col">
                {displayedLines.map((line, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex text-white/80 whitespace-pre"
                  >
                    <span className="text-white/20 select-none mr-4 w-4 text-right">{index + 1}</span>
                    <SyntaxHighlighter line={line} />
                  </motion.div>
                ))}

                {/* Blinking Cursor */}
                {displayedLines.length < codeLines.length && (
                  <motion.div
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                    className="flex mt-1"
                  >
                    <span className="text-white/0 select-none mr-4 w-4 text-right">{displayedLines.length + 1}</span>
                    <div className="w-2 h-5 bg-cyan-400/80" />
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * XSS-safe inline syntax highlighter for the demo terminal.
 * Uses React elements instead of dangerouslySetInnerHTML.
 */
function SyntaxHighlighter({ line }: { line: string }) {
  if (!line) return <span />;
  if (line.startsWith("//")) {
    return <span className="text-emerald-400/60 italic">{line}</span>;
  }

  const tokenPattern =
    /(\b(?:import|from|const|new|await)\b)|('(?:[^'\\]|\\.)*')|(\b(?:baseURL|apiKey|model|messages|role|content)\b(?=\s*:))/g;
  const tokens: { text: string; cls?: string }[] = [];
  let lastIdx = 0;
  let m: ReturnType<typeof tokenPattern.exec>;

  while ((m = tokenPattern.exec(line)) !== null) {
    if (m.index > lastIdx) {
      tokens.push({ text: line.slice(lastIdx, m.index) });
    }
    if (m[1]) tokens.push({ text: m[1], cls: "text-purple-400" });
    else if (m[2]) tokens.push({ text: m[2], cls: "text-emerald-300" });
    else if (m[3]) tokens.push({ text: m[3], cls: "text-cyan-300" });
    lastIdx = tokenPattern.lastIndex;
  }
  if (lastIdx < line.length) tokens.push({ text: line.slice(lastIdx) });

  return (
    <span>
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>{t.text}</span>
        ) : (
          <span key={i}>{t.text}</span>
        )
      )}
    </span>
  );
}
