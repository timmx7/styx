"use client";

import { useEffect, useState } from "react";
import { Copy, CheckCheck, ArrowRight, Box } from "lucide-react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getProjects, getAnalyticsOverview, getAnalyticsByProvider } from "@/lib/api";
import type { Project, AnalyticsOverview, ProviderStats } from "@/lib/types";
import Link from "next/link";

const ROUTER_URL = process.env.NEXT_PUBLIC_ROUTER_URL || "http://localhost:8080";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#1400FF",
  anthropic: "#06B6D4",
  mistral: "#10B981",
  google: "#F59E0B",
};

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [providers, setProviders] = useState<ProviderStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const fetchData = () => {
    Promise.allSettled([
      getProjects(),
      getAnalyticsOverview(7),
      getAnalyticsByProvider(7),
    ]).then(([projResult, analyticsResult, providerResult]) => {
      if (projResult.status === "fulfilled") {
        setProjects(projResult.value);
        if (projResult.value.length === 0) {
          setShowOnboarding(true);
        }
      }
      if (analyticsResult.status === "fulfilled") {
        setAnalytics(analyticsResult.value);
      }
      if (providerResult.status === "fulfilled") {
        setProviders(providerResult.value);
      }
    }).catch(() => {
      setError("Failed to load data. Please try again.");
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseUrl = `${ROUTER_URL}/v1`;

  const copyUrl = () => {
    navigator.clipboard.writeText(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnalytics = analytics != null && analytics.total_requests > 0;

  if (loading) {
    return (
      <div className="space-y-16 animate-pulse pt-4">
        <div className="h-24 rounded-none" style={{ borderTop: "1px solid #d6d0c8" }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20" style={{ borderTop: "1px solid #d6d0c8" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {showOnboarding && (
        <OnboardingWizard
          onComplete={() => {
            setShowOnboarding(false);
            fetchData();
          }}
        />
      )}

      {error && (
        <div className="mb-8 py-3 px-4 text-sm flex items-center justify-between" style={{ borderTop: "1px solid #dc2626", color: "#dc2626" }}>
          <p>{error}</p>
          <button onClick={() => { setError(null); fetchData(); }} className="underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {/* ─── GETTING STARTED ─── */}
      <section className="pt-6">
        <div style={{ borderTop: "1px solid #d6d0c8" }} className="pt-6">
          <span className="uppercase text-xs font-medium tracking-[0.2em]" style={{ color: "#6b6560" }}>
            Getting started
          </span>
        </div>

        <h2 className="font-serif text-2xl md:text-3xl font-normal mt-6" style={{ color: "#1a1a1a" }}>
          Your API endpoint.
        </h2>
        <p className="font-sans text-sm mt-2 max-w-md" style={{ color: "#6b6560" }}>
          Replace your provider&apos;s base URL with this. All requests are routed, cached, and optimized automatically.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={copyUrl}
            className="inline-flex items-center gap-3 rounded-full px-5 py-3 font-mono text-sm transition-all hover:opacity-90"
            style={{ backgroundColor: "#1a1a1a", color: "white" }}
          >
            <span>{baseUrl}</span>
            {copied ? (
              <CheckCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4 text-white/50" />
            )}
          </button>
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "#1400FF" }}
          >
            View documentation <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      {/* ─── AT A GLANCE ─── */}
      <section className="mt-16">
        <div style={{ borderTop: "1px solid #d6d0c8" }} className="pt-6">
          <span className="uppercase text-xs font-medium tracking-[0.2em]" style={{ color: "#6b6560" }}>
            At a glance
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6 mt-8">
          {[
            {
              label: "Total requests",
              value: hasAnalytics ? fmtNumber(analytics!.total_requests) : "0",
              sub: hasAnalytics ? `Last ${analytics!.period_days} days` : "No requests yet",
            },
            {
              label: "Avg latency",
              value: hasAnalytics ? `${Math.round(analytics!.avg_latency_ms)}ms` : "—",
              sub: hasAnalytics ? `${analytics!.period_days}d average` : "No data yet",
            },
            {
              label: "Cache hit rate",
              value: hasAnalytics ? `${(analytics!.cache_hit_rate * 100).toFixed(1)}%` : "—",
              sub: hasAnalytics ? `${analytics!.cache_hits} hits` : "No data yet",
            },
            {
              label: "Error rate",
              value: hasAnalytics ? `${(analytics!.error_rate * 100).toFixed(1)}%` : "—",
              sub: hasAnalytics ? `${analytics!.period_days}d window` : "No data yet",
            },
          ].map((stat) => (
            <div key={stat.label} className="pt-4" style={{ borderTop: "1px solid #d6d0c8" }}>
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "#6b6560" }}>
                {stat.label}
              </span>
              <p className="font-serif text-3xl md:text-4xl font-normal mt-2" style={{ color: "#1a1a1a" }}>
                {stat.value}
              </p>
              <p className="text-xs mt-1" style={{ color: "#9b9590" }}>
                {stat.sub}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── PROVIDERS ─── */}
      <section className="mt-16">
        <div style={{ borderTop: "1px solid #d6d0c8" }} className="pt-6">
          <span className="uppercase text-xs font-medium tracking-[0.2em]" style={{ color: "#6b6560" }}>
            Providers
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mt-8">
          {/* Provider list */}
          <div>
            <h3 className="font-serif text-xl font-normal" style={{ color: "#1a1a1a" }}>
              Traffic distribution
            </h3>
            <p className="text-sm mt-1 mb-6" style={{ color: "#6b6560" }}>
              {hasAnalytics ? `Request volume by provider, last ${analytics!.period_days} days.` : "Send your first request to see traffic data."}
            </p>

            {providers.length > 0 ? (
              <div className="space-y-4">
                {providers
                  .sort((a, b) => b.request_count - a.request_count)
                  .slice(0, 5)
                  .map((p) => {
                    const total = providers.reduce((s, pr) => s + pr.request_count, 0);
                    const pct = total > 0 ? (p.request_count / total) * 100 : 0;
                    return (
                      <div key={p.provider}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium capitalize" style={{ color: "#1a1a1a" }}>
                            {p.provider}
                          </span>
                          <span className="text-sm tabular-nums" style={{ color: "#6b6560" }}>
                            {fmtNumber(p.request_count)} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#d6d0c8" }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: PROVIDER_COLORS[p.provider.toLowerCase()] || "#6B7280",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-sm" style={{ color: "#9b9590" }}>
                No traffic data yet. Route your first request to see provider distribution here.
              </p>
            )}
          </div>

          {/* Quick actions */}
          <div>
            <h3 className="font-serif text-xl font-normal" style={{ color: "#1a1a1a" }}>
              Quick actions
            </h3>
            <p className="text-sm mt-1 mb-6" style={{ color: "#6b6560" }}>
              Common tasks to manage your gateway.
            </p>

            <div className="space-y-3">
              {[
                { label: "Create API key", href: "/keys", desc: "Generate a new key for your project" },
                { label: "Configure routing", href: "/routing", desc: "Set provider priorities and fallbacks" },
                { label: "View logs", href: "/logs", desc: "Inspect recent API requests" },
                { label: "Set budget", href: "/billing", desc: "Control spending with monthly limits" },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex items-center justify-between py-3 transition-colors"
                  style={{ borderBottom: "1px solid #d6d0c8" }}
                >
                  <div>
                    <span className="text-sm font-medium group-hover:opacity-70 transition-opacity" style={{ color: "#1a1a1a" }}>
                      {action.label}
                    </span>
                    <p className="text-xs mt-0.5" style={{ color: "#6b6560" }}>
                      {action.desc}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#1400FF" }} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── PROJECTS ─── */}
      <section className="mt-16 pb-8">
        <div style={{ borderTop: "1px solid #d6d0c8" }} className="pt-6">
          <span className="uppercase text-xs font-medium tracking-[0.2em]" style={{ color: "#6b6560" }}>
            Projects
          </span>
        </div>

        <h3 className="font-serif text-xl font-normal mt-6" style={{ color: "#1a1a1a" }}>
          Active environments
        </h3>
        <p className="text-sm mt-1" style={{ color: "#6b6560" }}>
          Your routing configurations and project settings.
        </p>

        {projects.length === 0 ? (
          <div className="mt-8 py-12 text-center" style={{ borderTop: "1px solid #d6d0c8" }}>
            <p style={{ color: "#9b9590" }}>No projects configured yet.</p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 mt-4 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#1400FF" }}
            >
              Create your first project <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="mt-6">
            {projects.slice(0, 5).map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between py-5"
                style={{ borderBottom: "1px solid #d6d0c8" }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(20,0,255,0.04)", border: "1px solid rgba(20,0,255,0.1)" }}>
                    <Box className="w-5 h-5" style={{ color: "#1400FF" }} />
                  </div>
                  <div>
                    <p className="font-medium text-sm" style={{ color: "#1a1a1a" }}>{project.name}</p>
                    <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: "#6b6560" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active &middot; {project.routing_strategy}
                    </p>
                  </div>
                </div>

                <span className="text-sm" style={{ color: "#6b6560" }}>
                  {project.budget_monthly_cents ? `$${(project.budget_monthly_cents / 100).toFixed(0)}/mo` : "No limit"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
