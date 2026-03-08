"use client";

import { useEffect, useState } from "react";
import { UsersRound, Download } from "lucide-react";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import { getAnalyticsEndUsers, getProjects } from "@/lib/api";
import type { EndUserAnalytics, Project } from "@/lib/types";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { SkeletonCard } from "@/components/ui/skeleton-card";
import { exportCSV } from "@/lib/export-csv";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

function formatCents(cents: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    }).format(cents / 100);
}

function ComingSoonWrapper({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative">
            <div className="pointer-events-none select-none blur-sm opacity-40">
                {children}
            </div>
            <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center">
                    <span className="bg-indigo-600 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                        🚀 Coming Soon
                    </span>
                </div>
            </div>
        </div>
    );
}

export default function EndUsersPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>("");
    const [users, setUsers] = useState<EndUserAnalytics[]>([]);
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [usersLoading, setUsersLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getProjects()
            .then((p) => {
                setProjects(p);
                if (p.length > 0) {
                    setSelectedProject(p[0].id);
                }
            })
            .catch(() => setError("Failed to load projects"))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!selectedProject) return;

        setUsersLoading(true);
        setError(null);
        getAnalyticsEndUsers(selectedProject, days)
            .then(setUsers)
            .catch(() => setError("Failed to load users analytics."))
            .finally(() => setUsersLoading(false));
    }, [selectedProject, days]);

    const handleExport = () => {
        if (users.length === 0) return;
        exportCSV(
            users.map((u) => ({
                user_id: u.user_id,
                requests: u.total_requests,
                tokens: u.total_tokens,
                cost_cents: u.total_cost,
                latency_ms: u.avg_latency,
            })),
            {
                filename: `styx-users-analytics-${days}d.csv`,
                headers: {
                    user_id: "User ID",
                    requests: "Requests",
                    tokens: "Tokens",
                    cost_cents: "Cost (Cents)",
                    latency_ms: "Avg Latency (ms)"
                },
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
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <div className="space-y-8">
                <Breadcrumbs />
                <Card className="border-border/50">
                    <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                        <p>No projects available. Create a project to view user analytics.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <ComingSoonWrapper>
        <div className="space-y-8">
            <Breadcrumbs />

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>End-User Analytics</h1>
                    <p className="mt-1 text-muted-foreground">
                        Monitor cost and usage driven by individual end users (`X-End-User-Id`).
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

            {/* Project Selector */}
            <div className="flex items-center gap-4">
                <Label htmlFor="project">Project</Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                    <SelectTrigger className="w-[300px]" id="project">
                        <SelectValue placeholder="Select a project" />
                    </SelectTrigger>
                    <SelectContent>
                        {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                {p.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {error && (
                <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-500 border border-red-500/20">
                    <p>{error}</p>
                </div>
            )}

            {/* Content Table */}
            <Card>
                <Table>
                    <thead>
                        <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                            <th className="px-6 py-4 font-normal">End-User ID</th>
                            <th className="px-6 py-4 font-normal text-right">Requests</th>
                            <th className="px-6 py-4 font-normal text-right">Tokens</th>
                            <th className="px-6 py-4 font-normal text-right">Cost</th>
                            <th className="px-6 py-4 font-normal text-right">Avg Latency</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr
                                key={user.user_id}
                                className="group border-b border-border/50 transition-colors hover:bg-secondary/50"
                            >
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="font-mono text-sm font-medium">
                                            {user.user_id}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="font-mono text-sm text-muted-foreground">
                                        {user.total_requests.toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="font-mono text-sm text-muted-foreground">
                                        {user.total_tokens.toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="font-mono text-sm font-medium" style={{ color: "#1400FF" }}>
                                        {formatCents(user.total_cost)}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="font-mono text-sm text-muted-foreground">
                                        {Math.round(user.avg_latency)}ms
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && !usersLoading && (
                            <tr>
                                <td colSpan={5} className="p-12 text-center text-muted-foreground">
                                    <UsersRound className="mx-auto mb-4 h-8 w-8 text-muted-foreground/50" />
                                    <p>No end-user activity recorded for this period.</p>
                                    <p className="mt-1 text-xs text-muted-foreground/70">
                                        Ensure your API requests include the <code className="bg-secondary border border-border px-1 py-0.5 rounded ml-1">X-End-User-Id</code> header.
                                    </p>
                                </td>
                            </tr>
                        )}
                        {usersLoading && (
                            <tr>
                                <td colSpan={5} className="p-12 text-center text-muted-foreground">
                                    <div className="flex items-center justify-center space-x-2">
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                        <span>Loading user data...</span>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            </Card>
        </div>
        </ComingSoonWrapper>
    );
}

// Inline Table component
function Table({ children }: { children: React.ReactNode }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                {children}
            </table>
        </div>
    );
}
