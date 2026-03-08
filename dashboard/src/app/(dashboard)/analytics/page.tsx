"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
    Activity,
    Clock,
    Database,
    AlertTriangle,
    Download,
} from "lucide-react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    getAnalyticsOverview,
    getAnalyticsByProvider,
    getAnalyticsByDay,
    getAnalyticsByModel,
} from "@/lib/api";
import type {
    AnalyticsOverview,
    ProviderStats,
    DailyStats,
    ModelStats,
} from "@/lib/types";
import { exportCSV } from "@/lib/export-csv";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { SkeletonCard, SkeletonChart } from "@/components/ui/skeleton-card";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from "recharts";

// ─── Lazy-loaded chart components (bundle splitting for Recharts) ─

const DailyVolumeChart = dynamic(
    () => import("@/components/charts/daily-volume-chart"),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-[180px] items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        ),
    }
);

const ProviderChart = dynamic(
    () => import("@/components/charts/provider-chart"),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-[180px] items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        ),
    }
);

// ─── Stat Card Component ────────────────────────────────────────

function StatCard({
    title,
    value,
    suffix,
    description,
    icon: Icon,
    variant = "default",
}: {
    title: string;
    value: string | number;
    suffix?: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    variant?: "default" | "success" | "warning" | "danger";
}) {
    const variantClasses = {
        default: "text-primary",
        success: "text-green-500",
        warning: "text-yellow-500",
        danger: "text-red-500",
    };

    return (
        <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    {title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${variantClasses[variant]}`} />
            </CardHeader>
            <CardContent>
                <div className="text-3xl font-bold">
                    {value}
                    {suffix && (
                        <span className="ml-1 text-lg font-normal text-muted-foreground">
                            {suffix}
                        </span>
                    )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

// ─── Provider hex colors for Recharts fills (used by Model Usage) ─

const PROVIDER_HEX: Record<string, string> = {
    openai: "#22c55e",
    anthropic: "#f97316",
    google: "#3b82f6",
    mistral: "#a855f7",
    azure: "#06b6d4",
};

const PROVIDER_FILL = (provider: string) =>
    PROVIDER_HEX[provider] ?? "#8b5cf6";

// ─── Custom Recharts Tooltip (used by Model Usage) ──────────────

function ChartTooltip({
    active,
    payload,
    label,
    suffix = "",
}: {
    active?: boolean;
    payload?: { value: number; name: string; color?: string }[];
    label?: string;
    suffix?: string;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md">
            {label && (
                <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
            )}
            {payload.map((entry, i) => (
                <p key={i} className="text-sm font-semibold">
                    {entry.value.toLocaleString()}
                    {suffix && <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span>}
                </p>
            ))}
        </div>
    );
}

// ─── Page Component ─────────────────────────────────────────────

export default function AnalyticsPage() {
    const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
    const [byProvider, setByProvider] = useState<ProviderStats[]>([]);
    const [byDay, setByDay] = useState<DailyStats[]>([]);
    const [byModel, setByModel] = useState<ModelStats[]>([]);
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            getAnalyticsOverview(days),
            getAnalyticsByProvider(days),
            getAnalyticsByDay(days),
            getAnalyticsByModel(days),
        ])
            .then(([ov, prov, daily, model]) => {
                setOverview(ov);
                setByProvider(prov);
                setByDay(daily);
                setByModel(model);
            })
            .catch(() => {
                setError("Failed to load analytics data. Please try again.");
            })
            .finally(() => setLoading(false));
    }, [days]);

    const handleExport = () => {
        if (byDay.length === 0) return;
        exportCSV(
            byDay.map((d) => ({
                date: d.date,
                requests: d.request_count,
            })),
            {
                filename: `styx-analytics-${days}d.csv`,
                headers: { date: "Date", requests: "Request Count" },
            },
        );
    };

    if (loading) {
        return (
            <div className="space-y-8">
                <Breadcrumbs />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                    <SkeletonChart />
                    <SkeletonChart />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <Breadcrumbs />
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Analytics</h1>
                    <p className="mt-1 text-muted-foreground">
                        Monitor your API gateway performance and usage.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        title="Export as CSV"
                    >
                        <Download className="h-4 w-4" />
                        Export
                    </button>
                    <div className="flex gap-2">
                        {[7, 30, 90].map((d) => (
                            <button
                                key={d}
                                onClick={() => setDays(d)}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${days === d
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-muted-foreground hover:text-foreground"
                                    }`}
                            >
                                {d}d
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-4 rounded-lg p-4 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }} role="alert">
                    <p>{error}</p>
                    <button
                        onClick={() => {
                            setError(null);
                            setLoading(true);
                            Promise.all([
                                getAnalyticsOverview(days),
                                getAnalyticsByProvider(days),
                                getAnalyticsByDay(days),
                                getAnalyticsByModel(days),
                            ])
                                .then(([ov, prov, daily, model]) => {
                                    setOverview(ov);
                                    setByProvider(prov);
                                    setByDay(daily);
                                    setByModel(model);
                                })
                                .catch(() => {
                                    setError("Failed to load analytics data. Please try again.");
                                })
                                .finally(() => setLoading(false));
                        }}
                        className="mt-2 text-xs underline hover:text-red-500"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Overview stat cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Requests"
                    value={overview?.total_requests?.toLocaleString() || "0"}
                    description={`Last ${days} days`}
                    icon={Activity}
                />
                <StatCard
                    title="Avg Latency"
                    value={overview?.avg_latency_ms || 0}
                    suffix="ms"
                    description="Average response time"
                    icon={Clock}
                    variant={
                        (overview?.avg_latency_ms || 0) > 2000 ? "danger" :
                            (overview?.avg_latency_ms || 0) > 1000 ? "warning" : "success"
                    }
                />
                <StatCard
                    title="Cache Hit Rate"
                    value={`${((overview?.cache_hit_rate || 0) * 100).toFixed(1)}%`}
                    description={`${overview?.cache_hits || 0} cache hits`}
                    icon={Database}
                    variant={(overview?.cache_hit_rate || 0) > 0.2 ? "success" : "default"}
                />
                <StatCard
                    title="Error Rate"
                    value={`${((overview?.error_rate || 0) * 100).toFixed(1)}%`}
                    description={`Fallback rate: ${((overview?.fallback_rate || 0) * 100).toFixed(1)}%`}
                    icon={AlertTriangle}
                    variant={
                        (overview?.error_rate || 0) > 0.05 ? "danger" :
                            (overview?.error_rate || 0) > 0.01 ? "warning" : "success"
                    }
                />
            </div>

            {/* Charts row -- lazy-loaded for bundle splitting */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Daily request volume (lazy-loaded) */}
                <Card className="border-border/50">
                    <CardHeader>
                        <CardTitle className="text-base">Daily Request Volume</CardTitle>
                        <CardDescription>Requests per day over the selected period</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DailyVolumeChart data={byDay} />
                    </CardContent>
                </Card>

                {/* Provider distribution (lazy-loaded) */}
                <Card className="border-border/50">
                    <CardHeader>
                        <CardTitle className="text-base">Provider Distribution</CardTitle>
                        <CardDescription>Request volume by provider</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ProviderChart data={byProvider} />
                    </CardContent>
                </Card>
            </div>

            {/* Model usage */}
            <Card className="border-border/50">
                <CardHeader>
                    <CardTitle className="text-base">Model Usage</CardTitle>
                    <CardDescription>
                        Which AI models are being used most frequently
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {byModel.length > 0 ? (
                        <ResponsiveContainer width="100%" height={Math.max(byModel.length * 40, 120)}>
                            <BarChart
                                data={byModel}
                                layout="vertical"
                                margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="hsl(var(--border))"
                                    horizontal={false}
                                />
                                <XAxis
                                    type="number"
                                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                />
                                <YAxis
                                    type="category"
                                    dataKey="model"
                                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                                    tickLine={false}
                                    axisLine={false}
                                    width={140}
                                />
                                <Tooltip
                                    content={<ChartTooltip suffix="requests" />}
                                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                                />
                                <Bar
                                    dataKey="request_count"
                                    radius={[0, 4, 4, 0]}
                                    animationDuration={600}
                                >
                                    {byModel.map((entry) => (
                                        <Cell
                                            key={entry.model}
                                            fill={PROVIDER_FILL(entry.provider)}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No model usage data yet.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
