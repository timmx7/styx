"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getAvailableModels } from "@/lib/api";
import type { RouterModel } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { toast } from "sonner";
import { Cpu, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Provider styling ─────────────────────────────────────────
const PROVIDER_COLORS: Record<string, { badge: string; dot: string }> = {
  openai:    { badge: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20", dot: "bg-emerald-500" },
  anthropic: { badge: "bg-orange-500/10 text-orange-700 border-orange-500/20",   dot: "bg-orange-500" },
  google:    { badge: "bg-blue-500/10 text-blue-700 border-blue-500/20",          dot: "bg-blue-500" },
  mistral:   { badge: "bg-purple-500/10 text-purple-700 border-purple-500/20",   dot: "bg-purple-500" },
};

const TIER_COLORS: Record<string, string> = {
  light:  "bg-green-500/10 text-green-700 border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  heavy:  "bg-red-500/10 text-red-700 border-red-500/20",
};

const PROVIDER_LABELS: Record<string, string> = {
  openai:    "OpenAI",
  anthropic: "Anthropic",
  google:    "Google",
  mistral:   "Mistral",
};

function formatPrice(price: number | undefined): string {
  if (price === undefined || price === 0) return "—";
  if (price < 0.1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(2)}`;
}

function PricingCell({ input, output }: { input?: number; output?: number }) {
  if (!input && !output) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="text-xs text-right leading-relaxed">
      <div className="text-foreground font-medium">{formatPrice(input)} <span className="text-muted-foreground font-normal">in</span></div>
      <div className="text-muted-foreground">{formatPrice(output)} out</div>
    </div>
  );
}

export default function ModelsPage() {
  const [models, setModels] = useState<RouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string>("all");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const data = await getAvailableModels();
      setModels(data);
      setLastRefresh(new Date());
    } catch (err) {
      toast.error("Failed to load model catalog");
      Sentry.captureException(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  // Derived state
  const providers = ["all", ...Array.from(new Set(models.map((m) => m.provider))).sort()];

  const filtered = models.filter((m) => {
    const matchesSearch =
      search === "" ||
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.provider.toLowerCase().includes(search.toLowerCase());
    const matchesProvider = activeProvider === "all" || m.provider === activeProvider;
    return matchesSearch && matchesProvider;
  });

  const byProvider: Record<string, RouterModel[]> = {};
  for (const m of filtered) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }

  const availableCount = models.filter((m) => m.available).length;

  return (
    <div className="space-y-8 pb-10">
      <Breadcrumbs />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>
            Model Catalog
          </h1>
          <p className="mt-1 text-muted-foreground max-w-2xl">
            {loading
              ? "Loading…"
              : `${models.length} models across ${providers.length - 1} providers — ${availableCount} available. Prices updated every 24h from OpenRouter.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Refreshed {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchModels} disabled={loading} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {providers.map((p) => (
            <button
              key={p}
              onClick={() => setActiveProvider(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                activeProvider === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {p === "all" ? "All providers" : (PROVIDER_LABELS[p] ?? p)}
              <span className="ml-1.5 opacity-60">
                {p === "all" ? models.length : models.filter((m) => m.provider === p).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-48" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Cpu className="h-10 w-10 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium">No models found</h3>
            <p className="text-muted-foreground mt-1">Try a different search or provider filter.</p>
          </CardContent>
        </Card>
      )}

      {/* Model tables by provider */}
      {!loading &&
        Object.entries(byProvider)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([provider, providerModels]) => {
            const colors = PROVIDER_COLORS[provider] ?? {
              badge: "bg-gray-500/10 text-gray-700 border-gray-500/20",
              dot: "bg-gray-400",
            };
            return (
              <Card key={provider}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-3 text-base font-medium">
                    <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                    {PROVIDER_LABELS[provider] ?? provider}
                    <Badge variant="outline" className={`text-[10px] font-medium ${colors.badge}`}>
                      {providerModels.length} models
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-t border-border">
                          <th className="text-left px-6 py-2.5 text-xs font-medium text-muted-foreground w-full">
                            Model
                          </th>
                          <th className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            Tier
                          </th>
                          <th className="text-right px-6 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            Price / 1M tokens
                          </th>
                          <th className="text-center px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {providerModels.map((model) => (
                          <tr
                            key={model.id}
                            className="hover:bg-secondary/50 transition-colors"
                          >
                            {/* Model ID */}
                            <td className="px-6 py-3">
                              <code className="text-xs font-mono text-foreground">
                                {model.id}
                              </code>
                            </td>
                            {/* Tier */}
                            <td className="px-4 py-3 text-center">
                              {model.tier ? (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-medium capitalize ${TIER_COLORS[model.tier] ?? ""}`}
                                >
                                  {model.tier}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            {/* Pricing */}
                            <td className="px-6 py-3">
                              <PricingCell
                                input={model.pricing?.input_per_million}
                                output={model.pricing?.output_per_million}
                              />
                            </td>
                            {/* Status */}
                            <td className="px-4 py-3 text-center">
                              {model.available ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                  Live
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="h-1.5 w-1.5 rounded-full bg-border" />
                                  No key
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
    </div>
  );
}
