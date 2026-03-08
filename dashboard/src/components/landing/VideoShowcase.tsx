"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

/* Mini animated bar chart */
function MiniBarChart() {
  const baseHeights = [45, 62, 38, 71, 55, 82, 68, 90, 75, 63, 85, 95, 78, 88, 70, 92, 80, 65, 73, 86, 94, 88, 76, 82];

  return (
    <div className="flex items-end gap-[3px] h-full pt-4">
      {baseHeights.map((h, i) => (
        <motion.div
          key={i}
          className="flex-1 rounded-t"
          initial={{ height: 0 }}
          whileInView={{ height: `${h}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, delay: i * 0.02, ease: "easeOut" }}
          style={{
            background: "linear-gradient(to top, rgba(16,185,129,0.8), rgba(96,165,250,0.8))",
          }}
        />
      ))}
    </div>
  );
}

/* Donut chart */
function MiniDonut() {
  return (
    <div className="flex items-center justify-center h-full relative">
      <motion.div
        initial={{ rotate: -90, scale: 0.8, opacity: 0 }}
        whileInView={{ rotate: 0, scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.5, type: "spring" }}
        className="rounded-full flex items-center justify-center shadow-lg"
        style={{
          width: 130,
          height: 130,
          background: "conic-gradient(#10B981 0% 45%, #3B82F6 45% 75%, #8B5CF6 75% 90%, rgba(255,255,255,0.05) 90%)",
        }}
      >
        <div
          className="rounded-full flex flex-col items-center justify-center shadow-inner"
          style={{ width: 85, height: 85, background: "#0a0a0a" }}
        >
          <span className="text-white text-xl font-extrabold tracking-tight">4</span>
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>
            providers
          </span>
        </div>
      </motion.div>
    </div>
  );
}

/* Stat card */
function StatCard({ label, value, change, positive, delay }: { label: string; value: string; change: string; positive: boolean; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="rounded-xl p-5 relative overflow-hidden group"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="text-[12px] font-medium tracking-wide uppercase mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
        {label}
      </div>
      <div className="text-3xl font-bold text-white tracking-tight">{value}</div>
      <div className="text-[11px] mt-2 font-medium flex items-center gap-1" style={{ color: positive ? "#10B981" : "#F43F5E" }}>
        {positive ? "↗" : "↘"} {change}
      </div>
    </motion.div>
  );
}

/* Sidebar nav item */
function NavItem({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12px] font-medium flex items-center gap-3 transition-colors cursor-default"
      style={{
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        color: active ? "#ffffff" : "rgba(255,255,255,0.4)",
      }}
    >
      <div
        className="rounded border"
        style={{
          width: 14,
          height: 14,
          background: active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)",
          borderColor: active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"
        }}
      />
      {label}
    </div>
  );
}

export function VideoShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [0, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [100, 0]);
  const rotateX = useTransform(scrollYProgress, [0, 1], [20, 0]);

  return (
    <section ref={ref} className="px-6 py-20 relative z-20 perspective-1000">

      {/* Title above showcase */}
      <div className="text-center mb-16 max-w-2xl mx-auto">
        <h2 className="font-serif text-3xl md:text-5xl font-bold mb-4 text-white">Full visibility. Zero overhead.</h2>
        <p className="text-white/50 text-lg">Your entire AI fleet monitored, controlled, and optimized from a single pane of glass.</p>
      </div>

      <motion.div
        style={{ scale, opacity, y, rotateX }}
        className="max-w-[1240px] mx-auto relative rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Deep premium glass frame */}
        <div className="absolute inset-0 rounded-3xl border border-white/10 bg-white/[0.01] pointer-events-none" />
        <div className="absolute inset-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] rounded-3xl pointer-events-none" />
        <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-white/10 to-transparent opacity-50 pointer-events-none" />

        {/* Browser Top Bar */}
        <div className="bg-[#0f0f0f] border-b border-white/5 h-12 flex items-center px-4 gap-2 relative z-10 rounded-t-3xl">
          <div className="w-3 h-3 rounded-full bg-white/[0.15]" />
          <div className="w-3 h-3 rounded-full bg-white/[0.15]" />
          <div className="w-3 h-3 rounded-full bg-white/[0.15]" />
          <div className="absolute left-1/2 -translate-x-1/2 w-64 h-6 border border-white/5 rounded-md bg-white/[0.02] flex items-center justify-center text-[10px] text-white/30 font-mono">
            app.styx.sh
          </div>
        </div>

        {/* Dashboard body */}
        <div className="relative flex overflow-hidden bg-[#050505] rounded-b-3xl" style={{ aspectRatio: "16/9" }}>

          {/* ─── Sidebar ─── */}
          <div className="flex flex-col gap-1 p-5 shrink-0 w-56 border-r border-white/5 bg-[#0a0a0a]">
            <div className="text-white font-bold tracking-widest px-2 mb-8 mt-2 flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-cyan-400 to-emerald-400" />
              STYX
            </div>

            <div className="text-[10px] font-bold tracking-widest text-white/30 px-3 mb-2 mt-4">CORE</div>
            <NavItem label="Overview" active />
            <NavItem label="Routing Logs" />
            <NavItem label="Analytics" />

            <div className="text-[10px] font-bold tracking-widest text-white/30 px-3 mb-2 mt-6">MANAGEMENT</div>
            <NavItem label="API Keys" />
            <NavItem label="Projects" />
            <NavItem label="A/B Tests" />
            <NavItem label="Billing" />
          </div>

          {/* ─── Main area ─── */}
          <div className="flex-1 flex flex-col min-w-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/[0.03] via-[#050505] to-[#050505]">

            {/* Header bar */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-white/5">
              <span className="text-white font-semibold text-xl tracking-tight">Overview</span>
              <div className="flex items-center gap-4">
                <span className="text-[11px] font-bold tracking-widest px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/70">
                  ENTERPRISE
                </span>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-emerald-400 border border-white/20" />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 p-8 overflow-y-auto">
              {/* Stat cards row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
                <StatCard label="Total Requests" value="12.4M" change="+24.5% vs last week" positive delay={0.1} />
                <StatCard label="Avg Latency" value="42ms" change="-12.3% vs direct" positive delay={0.2} />
                <StatCard label="Cache Hit Rate" value="68.4%" change="+5.1% efficiency" positive delay={0.3} />
                <StatCard label="Cost Saved" value="$4,280" change="This Billing Cycle" positive delay={0.4} />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Main Graph */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 }}
                  className="col-span-1 md:col-span-2 rounded-2xl p-6 border border-white/5 bg-white/[0.01]"
                >
                  <div className="flex justify-between items-center mb-6">
                    <div className="text-white text-sm font-semibold tracking-wide">Network Traffic</div>
                    <div className="text-white/40 text-xs flex gap-4">
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-400"></div> Cached</span>
                      <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-blue-400"></div> Fresh</span>
                    </div>
                  </div>
                  <div style={{ height: 220 }}>
                    <MiniBarChart />
                  </div>
                </motion.div>

                {/* Donut Graph */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.6 }}
                  className="col-span-1 rounded-2xl p-6 border border-white/5 bg-white/[0.01] flex flex-col"
                >
                  <div className="text-white text-sm font-semibold tracking-wide mb-6">Provider Distribution</div>
                  <div className="flex-1 relative">
                    <MiniDonut />
                  </div>
                </motion.div>

              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
