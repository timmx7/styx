"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getRoutingLogs, getProjects, downloadDataset } from "@/lib/api";
import type { RoutingLog, Project } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Activity, Clock, Cpu, Database, Zap, Download } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TableSkeleton } from "@/components/ui/skeleton";

// ─── Provider color mapping ────────────────────────────────────
const providerColors: Record<string, string> = {
  openai: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  anthropic: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  google: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  mistral: "bg-purple-500/10 text-purple-600 border-purple-500/20",
};

const complexityColors: Record<string, string> = {
  simple: "bg-green-500/10 text-green-600 border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  complex: "bg-red-500/10 text-red-600 border-red-500/20",
};

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-green-600";
  if (code >= 400 && code < 500) return "text-yellow-600";
  return "text-red-600";
}

export default function RoutingPage() {
  const [logs, setLogs] = useState<RoutingLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const fetchLogs = async (projectId?: string) => {
    try {
      const data = await getRoutingLogs(
        100,
        projectId && projectId !== "all" ? projectId : undefined
      );
      setLogs(data);
    } catch (err) {
      toast.error("Failed to load routing logs");
      Sentry.captureException(err);
    }
  };

  useEffect(() => {
    Promise.all([getProjects(), getRoutingLogs(100)])
      .then(([p, l]) => {
        setProjects(p);
        setLogs(l);
      })
      .catch(() => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const handleProjectChange = (value: string) => {
    setSelectedProject(value);
    fetchLogs(value);
  };

  // ─── Compute stats ──────────────────────────────────────────
  const totalRequests = logs.length;
  const avgLatency =
    totalRequests > 0
      ? Math.round(logs.reduce((sum, l) => sum + l.latency_ms, 0) / totalRequests)
      : 0;
  const cacheHits = logs.filter((l) => l.cache_hit).length;
  const cacheRate =
    totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 100) : 0;
  const providerCounts = logs.reduce(
    (acc, l) => {
      acc[l.provider] = (acc[l.provider] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topProvider =
    Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const complexityCounts = logs.reduce(
    (acc, l) => {
      acc[l.complexity] = (acc[l.complexity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-8">
      <Breadcrumbs />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Routing</h1>
          <p className="mt-1 text-muted-foreground">
            See how requests are routed across AI providers in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedProject && selectedProject !== "all" && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={async () => {
                try {
                  toast.loading("Preparing dataset export...", { id: "export" });
                  await downloadDataset(selectedProject);
                  toast.success("Export downloaded", { id: "export" });
                } catch {
                  toast.error("Failed to export dataset", { id: "export" });
                }
              }}
            >
              <Download className="h-4 w-4" /> Export JSONL
            </Button>
          )}
          <Select value={selectedProject} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Routed
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRequests}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Latency
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgLatency} ms</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Provider
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{topProvider}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cache Hit Rate
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {cacheRate}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({cacheHits}/{totalRequests})
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Complexity Split
            </CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {Object.entries(complexityCounts).map(([k, v]) => (
                <Badge key={k} variant="outline" className={complexityColors[k]}>
                  {k}: {v}
                </Badge>
              ))}
              {totalRequests === 0 && (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>
            Last {logs.length} routed requests with provider, model, and latency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : logs.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
              <Activity className="mb-2 h-8 w-8" />
              <p>No routing logs yet.</p>
              <p className="text-sm">
                Send requests through the gateway to see them here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Complexity</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            providerColors[log.provider] ||
                            "bg-gray-500/10 text-gray-600 border-gray-500/20"
                          }
                        >
                          {log.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {log.model}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            complexityColors[log.complexity] ||
                            "bg-gray-500/10 text-gray-600 border-gray-500/20"
                          }
                        >
                          {log.complexity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {log.cache_hit && (
                            <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
                              cached
                            </Badge>
                          )}
                          {log.was_fallback && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                              fallback
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {log.latency_ms} ms
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${statusColor(log.status_code)}`}
                      >
                        {log.status_code}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
