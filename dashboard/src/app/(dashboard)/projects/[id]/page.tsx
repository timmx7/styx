"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Copy,
  CheckCheck,
  Eye,
  EyeOff,
  Trash2,
  KeyRound,
  Activity,
  AlertTriangle,
  DollarSign,
  Clock,
  Zap,
  Shield,
  Users,
  Code,
  CreditCard,
  Crown,
  UserCircle,
  LogOut,
  FileJson,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getProject,
  getApiKeys,
  createApiKey,
  revokeApiKey,
  getRoutingLogs,
  getBudgets,
  updateBudget,
  getAlerts,
  updateProject,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  getMe,
  ProjectMember,
  getABTests,
} from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Project,
  ApiKey,
  ApiKeyCreated,
  RoutingLog,
  BudgetStatus,
  Alert,
  ABTestExperiment,
} from "@/lib/types";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardSkeleton, StatsGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { ABTestingList } from "@/components/projects/ABTestingList";

// ─── Provider color map (reused from analytics) ─────────────────

const providerColors: Record<string, string> = {
  openai: "bg-green-500/10 text-green-500",
  anthropic: "bg-orange-500/10 text-orange-500",
  google: "bg-blue-500/10 text-blue-500",
  mistral: "bg-purple-500/10 text-purple-500",
  azure: "bg-cyan-500/10 text-cyan-600",
};

const severityColors: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500",
  warning: "bg-yellow-500/10 text-yellow-500",
  info: "bg-blue-500/10 text-blue-500",
};

// ─── Page Component ─────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  // ── State ──
  const [project, setProject] = useState<Project | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<RoutingLog[]>([]);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [abTests, setAbTests] = useState<ABTestExperiment[]>([]);
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Create key dialog
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState("");

  // Budget edit dialog
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetForm, setBudgetForm] = useState({
    budget: "",
    alertThreshold: "",
  });

  // Member add dialog
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [memberForm, setMemberForm] = useState({
    userId: "",
    role: "developer",
  });

  // Guardrails Dialog
  const [guardrailsDialogOpen, setGuardrailsDialogOpen] = useState(false);
  const [guardrailsJson, setGuardrailsJson] = useState("{}");
  const [savingGuardrails, setSavingGuardrails] = useState(false);

  // Advanced Settings Dialog
  const [advancedDialogOpen, setAdvancedDialogOpen] = useState(false);
  const [advancedForm, setAdvancedForm] = useState({ endUserRateLimit: "0" });
  const [savingAdvanced, setSavingAdvanced] = useState(false);

  // ── Data fetching ──
  const fetchData = useCallback(() => {
    Promise.all([
      getProject(projectId),
      getApiKeys(projectId),
      getRoutingLogs(20, projectId),
      getBudgets(),
      getAlerts(10),
      getProjectMembers(projectId).catch(() => []), // Viewer or Admin
      getABTests(projectId).catch(() => []),
      getMe().catch(() => null),
    ])
      .then(([proj, k, l, budgets, a, m, tests, meData]) => {
        setProject(proj);
        setKeys(k);
        setLogs(l);
        // Find budget for this project
        const projBudget = budgets.find((b) => b.project_id === projectId) || null;
        setBudget(projBudget);
        // Filter alerts for this project
        setAlerts(a.filter((alert) => alert.project_id === projectId));
        setMembers(m);
        setAbTests(tests);
        setMe(meData);
      })
      .catch((err) => {
        if (err instanceof Error && err.message.includes("404")) {
          setNotFound(true);
        } else {
          toast.error("Failed to load project data");
        }
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Handlers ──

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingKey(true);
    try {
      const key = await createApiKey({
        project_id: projectId,
        name: keyName || undefined,
      });
      setNewKey(key);
      toast.success("API key created!");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) return;
    try {
      await revokeApiKey(keyId);
      toast.success("API key revoked");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBudget(true);
    try {
      const budgetCents = budgetForm.budget
        ? Math.round(parseFloat(budgetForm.budget) * 100)
        : undefined;
      const threshold = budgetForm.alertThreshold
        ? parseInt(budgetForm.alertThreshold, 10)
        : undefined;
      await updateBudget(projectId, {
        budget_monthly_cents: budgetCents ?? null,
        alert_threshold_pct: threshold,
      });
      toast.success("Budget updated!");
      setBudgetDialogOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update budget");
    } finally {
      setSavingBudget(false);
    }
  };

  const handleTogglePrivacy = async () => {
    if (!project) return;
    try {
      const newStatus = !project.pii_redaction_enabled;
      await updateProject(projectId, { pii_redaction_enabled: newStatus });
      setProject({ ...project, pii_redaction_enabled: newStatus });
      toast.success(`Data privacy ${newStatus ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update project settings");
    }
  };

  const handleSaveGuardrails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setSavingGuardrails(true);
    try {
      const parsedConfig = JSON.parse(guardrailsJson);
      await updateProject(projectId, { guardrails_config: parsedConfig });
      setProject({ ...project, guardrails_config: parsedConfig });
      toast.success("Guardrails configuration updated");
      setGuardrailsDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON format");
    } finally {
      setSavingGuardrails(false);
    }
  };

  const handleToggleSemanticCache = async () => {
    if (!project) return;
    try {
      const newStatus = !project.semantic_cache_enabled;
      await updateProject(projectId, { semantic_cache_enabled: newStatus });
      setProject({ ...project, semantic_cache_enabled: newStatus });
      toast.success(`Semantic Cache ${newStatus ? "enabled" : "disabled"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update Semantic Cache");
    }
  };

  const handleSaveAdvancedSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setSavingAdvanced(true);
    try {
      const rateLimit = parseInt(advancedForm.endUserRateLimit, 10);
      if (isNaN(rateLimit) || rateLimit < 0) {
        throw new Error("Invalid rate limit");
      }
      await updateProject(projectId, { end_user_rate_limit: rateLimit });
      setProject({ ...project, end_user_rate_limit: rateLimit });
      toast.success("Advanced settings updated");
      setAdvancedDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSavingAdvanced(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberForm.userId.trim()) return;
    setAddingMember(true);
    try {
      await addProjectMember(projectId, memberForm.userId.trim(), memberForm.role);
      toast.success("Member added to project!");
      setMemberDialogOpen(false);
      setMemberForm({ userId: "", role: "developer" });
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this user from the project?")) return;
    try {
      await removeProjectMember(projectId, userId);
      toast.success("Member removed");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const roleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return (
          <Badge className="gap-1 bg-purple-500/10 text-purple-600 hover:bg-purple-500/15">
            <Crown className="h-3 w-3" />
            Owner
          </Badge>
        );
      case "admin":
        return (
          <Badge className="gap-1 bg-blue-500/10 text-blue-600 hover:bg-blue-500/15">
            <Shield className="h-3 w-3" />
            Admin
          </Badge>
        );
      case "developer":
        return (
          <Badge variant="secondary" className="gap-1 text-muted-foreground">
            <Code className="h-3 w-3" />
            Developer
          </Badge>
        );
      case "billing":
        return (
          <Badge className="gap-1 bg-orange-500/10 text-orange-600 hover:bg-orange-500/15">
            <CreditCard className="h-3 w-3" />
            Billing
          </Badge>
        );
      case "viewer":
        return (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Eye className="h-3 w-3" />
            Viewer
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="gap-1 text-muted-foreground">
            <UserCircle className="h-3 w-3" />
            Member
          </Badge>
        );
    }
  };

  // ── Loading / Not Found ──

  if (loading) {
    return (
      <div className="space-y-8">
        <Breadcrumbs />
        <StatsGridSkeleton count={4} />
        <CardSkeleton />
        <TableSkeleton rows={5} cols={6} />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="space-y-8">
        <Button
          variant="ghost"
          className="gap-2 text-muted-foreground"
          onClick={() => router.push("/projects")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Button>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Project not found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This project doesn&apos;t exist or you don&apos;t have access to it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derived values ──
  const activeKeys = keys.filter((k) => k.is_active);
  const budgetPct = budget?.pct_used ?? 0;
  const budgetBarColor =
    budgetPct >= 90
      ? "bg-red-500"
      : budgetPct >= 75
        ? "bg-yellow-500"
        : "bg-primary";

  // ── Render ──

  return (
    <div className="space-y-8">
      {/* ── Back + Header ── */}
      <div>
        <Button
          variant="ghost"
          className="mb-4 gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => router.push("/projects")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>{project.name}</h1>
            <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <code className="rounded bg-secondary px-2 py-0.5 text-xs font-mono">
                {project.id.slice(0, 8)}...
              </code>
              <span>
                Created {new Date(project.created_at).toLocaleDateString()}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-foreground/5 text-foreground hover:bg-foreground/10">
              {project.routing_strategy}
            </Badge>
            {project.allowed_providers?.map((p) => (
              <Badge
                key={p}
                className={providerColors[p] || "bg-secondary text-foreground"}
              >
                {p}
              </Badge>
            ))}
            {!project.allowed_providers && (
              <Badge className="bg-secondary text-muted-foreground">
                All providers
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Overview Cards ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Budget Card */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Monthly Budget
            </CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {budget
                ? `$${(budget.spent_cents / 100).toFixed(2)}`
                : "$0.00"}
              {budget?.budget_cents && (
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / ${(budget.budget_cents / 100).toFixed(2)}
                </span>
              )}
            </div>
            {budget?.budget_cents ? (
              <div className="mt-2">
                <div className="h-2 rounded-full bg-secondary">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${budgetBarColor}`}
                    style={{ width: `${Math.min(budgetPct, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {budgetPct.toFixed(1)}% used
                  {budget.remaining_cents !== null &&
                    ` · $${(budget.remaining_cents / 100).toFixed(2)} remaining`}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">No budget limit set</p>
            )}
          </CardContent>
        </Card>

        {/* Active Keys */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Keys
            </CardTitle>
            <KeyRound className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeKeys.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {keys.length} total · {keys.length - activeKeys.length} revoked
            </p>
          </CardContent>
        </Card>

        {/* Recent Requests */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Requests
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {logs.filter((l) => l.cache_hit).length} cache hits ·{" "}
              {logs.filter((l) => l.was_fallback).length} fallbacks
            </p>
          </CardContent>
        </Card>

        {/* Avg Latency */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Latency
            </CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {(() => {
              const avgMs =
                logs.length > 0
                  ? Math.round(logs.reduce((sum, l) => sum + l.latency_ms, 0) / logs.length)
                  : 0;
              return (
                <>
                  <div className="text-2xl font-bold">
                    {avgMs}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Based on last {logs.length} requests
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* ── Settings (Budget + Routing) ── */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Project Settings</CardTitle>
            <CardDescription>Budget, Routing, and Advanced Optimizations</CardDescription>
          </div>
          <div className="flex gap-2">
            <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() =>
                    setBudgetForm({
                      budget: project.budget_monthly_cents
                        ? (project.budget_monthly_cents / 100).toString()
                        : "",
                      alertThreshold: project.budget_alert_threshold_pct?.toString() || "80",
                    })
                  }
                >
                  <DollarSign className="h-4 w-4" />
                  Edit Budget
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Budget</DialogTitle>
                  <DialogDescription>
                    Set monthly spending limits and alert thresholds for{" "}
                    <strong>{project.name}</strong>.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSaveBudget} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="budgetAmount">Monthly Budget (USD)</Label>
                    <Input
                      id="budgetAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="100.00 (leave empty for unlimited)"
                      value={budgetForm.budget}
                      onChange={(e) =>
                        setBudgetForm({ ...budgetForm, budget: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="alertThreshold">Alert Threshold (%)</Label>
                    <Input
                      id="alertThreshold"
                      type="number"
                      min="1"
                      max="100"
                      placeholder="80"
                      value={budgetForm.alertThreshold}
                      onChange={(e) =>
                        setBudgetForm({ ...budgetForm, alertThreshold: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      You&apos;ll get an alert when spending reaches this % of the budget.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    disabled={savingBudget}
                  >
                    {savingBudget ? "Saving..." : "Save Budget"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={advancedDialogOpen} onOpenChange={setAdvancedDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() =>
                    setAdvancedForm({ endUserRateLimit: project.end_user_rate_limit?.toString() || "0" })
                  }
                >
                  <Zap className="h-4 w-4" />
                  Advanced
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Advanced Optimizations</DialogTitle>
                  <DialogDescription>
                    Configure End-User Rate Limiting (Phase 10) to prevent abuse from your downstream users.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSaveAdvancedSettings} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="endUserRateLimit">End-User Rate Limit (requests / min)</Label>
                    <Input
                      id="endUserRateLimit"
                      type="number"
                      min="0"
                      placeholder="0 (unlimited)"
                      value={advancedForm.endUserRateLimit}
                      onChange={(e) =>
                        setAdvancedForm({ ...advancedForm, endUserRateLimit: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Set limits based on the X-End-User-Id header. Enter 0 to disable.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    disabled={savingAdvanced}
                  >
                    {savingAdvanced ? "Saving..." : "Save Settings"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={guardrailsDialogOpen} onOpenChange={setGuardrailsDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 ml-2"
                  onClick={() =>
                    setGuardrailsJson(project.guardrails_config ? JSON.stringify(project.guardrails_config, null, 2) : "{}")
                  }
                >
                  <Shield className="h-4 w-4" />
                  Configure Guardrails
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Configure Guardrails</DialogTitle>
                  <DialogDescription>
                    Define strict JSON validation schema and toxicity filters for API requests & responses.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSaveGuardrails} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="guardrailsJson">Guardrails Configuration (JSON)</Label>
                    <textarea
                      id="guardrailsJson"
                      rows={10}
                      className="w-full font-mono text-sm p-3 rounded-md bg-secondary/50 border border-border resize-y"
                      placeholder='{"required_fields": ["id", "status"], "toxicity_threshold": 0.8}'
                      value={guardrailsJson}
                      onChange={(e) => setGuardrailsJson(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Must be a valid JSON object.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    disabled={savingGuardrails}
                  >
                    {savingGuardrails ? "Saving..." : "Save Guardrails"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Monthly Budget</p>
              <p className="text-sm font-semibold">
                {project.budget_monthly_cents
                  ? `$${(project.budget_monthly_cents / 100).toFixed(2)}`
                  : "Unlimited"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Alert Threshold</p>
              <p className="text-sm font-semibold">
                {project.budget_alert_threshold_pct}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Routing Strategy</p>
              <p className="text-sm font-semibold capitalize">{project.routing_strategy}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Data Privacy (PII)</p>
              <Button
                variant={project.pii_redaction_enabled ? "default" : "secondary"}
                size="sm"
                onClick={handleTogglePrivacy}
                className="h-7 px-2 text-xs"
              >
                {project.pii_redaction_enabled ? (
                  <><Shield className="w-3 h-3 mr-1" /> Enabled</>
                ) : (
                  <><Shield className="w-3 h-3 mr-1 opacity-50" /> Disabled</>
                )}
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Guardrails</p>
              {project.guardrails_config && Object.keys(project.guardrails_config).length > 0 ? (
                <Badge className="bg-emerald-500/10 text-emerald-600">
                  <FileJson className="mr-1 h-3 w-3" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Semantic Cache</p>
              <Button
                variant={project.semantic_cache_enabled ? "default" : "secondary"}
                size="sm"
                onClick={handleToggleSemanticCache}
                className="h-7 px-2 text-xs"
              >
                {project.semantic_cache_enabled ? (
                  <><Zap className="w-3 h-3 mr-1" /> Enabled</>
                ) : (
                  <><Zap className="w-3 h-3 mr-1 opacity-50" /> Disabled</>
                )}
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">End-User Limit</p>
              <p className="text-sm font-semibold">
                {project.end_user_rate_limit > 0 ? `${project.end_user_rate_limit} req/min` : "Unlimited"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── A/B Testing ── */}
      <ABTestingList projectId={projectId} experiments={abTests} onUpdate={fetchData} />

      {/* ── Project Members ── */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Project Access Control</CardTitle>
            <CardDescription>
              {members.length} explicit member{members.length !== 1 ? "s" : ""} added to this project. Team Owners and Admins implicitly have access.
            </CardDescription>
          </div>
          <Dialog
            open={memberDialogOpen}
            onOpenChange={setMemberDialogOpen}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Member to Project</DialogTitle>
                <DialogDescription>
                  Give an existing team member specific role access to <strong>{project.name}</strong>.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddMember} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="userId">User ID</Label>
                  <Input
                    id="userId"
                    placeholder="Enter the User UUID..."
                    value={memberForm.userId}
                    onChange={(e) => setMemberForm({ ...memberForm, userId: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Only existing team members can be added to individual projects. Provide their exact UUID.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={memberForm.role}
                    onValueChange={(v) => setMemberForm({ ...memberForm, role: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                  disabled={addingMember}
                >
                  {addingMember ? "Adding..." : "Add to Project"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Users className="h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No individual members have been explicitly granted access yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User / Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const isMe = me && m.user_id === me.id;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{m.user_email || m.user_name || "Unknown User"}</span>
                          <span className="text-xs text-muted-foreground font-mono">{m.user_id}</span>
                        </div>
                      </TableCell>
                      <TableCell>{roleBadge(m.role)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveMember(m.user_id)}
                          title={isMe ? "Leave Project" : "Remove user"}
                        >
                          {isMe ? <LogOut className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── API Keys ── */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">API Keys</CardTitle>
            <CardDescription>
              {activeKeys.length} active key{activeKeys.length !== 1 ? "s" : ""} for
              this project
            </CardDescription>
          </div>
          <Dialog
            open={keyDialogOpen}
            onOpenChange={(open) => {
              setKeyDialogOpen(open);
              if (!open) {
                setNewKey(null);
                setShowKey(false);
                setKeyName("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                New Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              {newKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Key created successfully</DialogTitle>
                    <DialogDescription>
                      Copy your key now. You won&apos;t be able to see it again.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-secondary p-4">
                      <div className="flex items-center justify-between gap-2">
                        <code className="flex-1 break-all text-sm">
                          {showKey
                            ? newKey.key
                            : newKey.key.slice(0, 12) + "..." + "*".repeat(40)}
                        </code>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setShowKey(!showKey)}
                          >
                            {showKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => copyToClipboard(newKey.key)}
                          >
                            {copied ? (
                              <CheckCheck className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-xs font-medium text-amber-600">
                        This key will only be shown once. Store it securely.
                      </p>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setKeyDialogOpen(false);
                        setNewKey(null);
                        setShowKey(false);
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                    <DialogDescription>
                      Create a new key for <strong>{project.name}</strong>. It will
                      only be shown once.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateKey} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="newKeyName">Key Name (optional)</Label>
                      <Input
                        id="newKeyName"
                        placeholder="production, staging, dev..."
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                      disabled={creatingKey}
                    >
                      {creatingKey ? "Creating..." : "Create Key"}
                    </Button>
                  </form>
                </>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No API keys yet. Create one to start using the gateway.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      {key.name || "Unnamed"}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-secondary px-2 py-1 text-xs">
                        {key.key_prefix}...
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.rate_limit_per_minute}/min
                    </TableCell>
                    <TableCell>
                      {key.is_active ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          Revoked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.last_used_at
                        ? new Date(key.last_used_at).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      {key.is_active && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRevokeKey(key.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Routing Logs ── */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Recent Requests</CardTitle>
          <CardDescription>
            Last {logs.length} routing decisions for this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Activity className="h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No requests yet. Send your first request through the API gateway.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Complexity</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge
                        className={`text-xs ${providerColors[log.provider] || "bg-secondary text-foreground"}`}
                      >
                        {log.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.model}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {log.complexity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.latency_ms}ms
                    </TableCell>
                    <TableCell>
                      {log.status_code >= 200 && log.status_code < 300 ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600">
                          {log.status_code}
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-red-500">
                          {log.status_code}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.input_tokens + log.output_tokens > 0
                        ? `${log.input_tokens}→${log.output_tokens}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {log.cache_hit && (
                          <Badge className="bg-blue-500/10 px-1.5 text-xs text-blue-600">
                            <Zap className="mr-0.5 h-3 w-3" />
                            Cache
                          </Badge>
                        )}
                        {log.was_fallback && (
                          <Badge className="bg-yellow-500/10 px-1.5 text-xs text-yellow-600">
                            <Shield className="mr-0.5 h-3 w-3" />
                            Fallback
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Alerts ── */}
      {alerts.length > 0 && (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Recent Alerts</CardTitle>
            <CardDescription>
              {alerts.filter((a) => !a.is_read).length} unread alert
              {alerts.filter((a) => !a.is_read).length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${alert.is_read
                  ? "border-border/50 bg-transparent"
                  : "border-primary/20 bg-primary/5"
                  }`}
              >
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 ${alert.severity === "critical"
                    ? "text-red-500"
                    : alert.severity === "warning"
                      ? "text-yellow-500"
                      : "text-blue-500"
                    }`}
                />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <Badge
                      className={`text-xs ${severityColors[alert.severity] || "bg-secondary text-foreground"}`}
                    >
                      {alert.severity}
                    </Badge>
                    {!alert.is_read && (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{alert.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
