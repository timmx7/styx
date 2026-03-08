"use client";

import { useEffect, useState } from "react";
import { Plus, KeyRound, Copy, CheckCheck, Eye, EyeOff, Trash2, Terminal } from "lucide-react";
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
  getApiKeys,
  getProjects,
  createApiKey,
  revokeApiKey,
} from "@/lib/api";
import type { ApiKey, ApiKeyCreated, Project } from "@/lib/types";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TableSkeleton } from "@/components/ui/skeleton";

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState({ projectId: "", name: "" });

  const fetchData = () => {
    Promise.all([getApiKeys(), getProjects()])
      .then(([k, p]) => {
        setKeys(k);
        setProjects(p);
      })
      .catch(() => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.projectId) {
      toast.error("Select a project first");
      return;
    }
    setCreating(true);

    try {
      const key = await createApiKey({
        project_id: form.projectId,
        name: form.name || undefined,
      });
      setNewKey(key);
      toast.success("API key created!");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) return;
    try {
      await revokeApiKey(keyId);
      toast.success("API key revoked");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const projectName = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.name || projectId.slice(0, 8);

  if (loading) {
    return (
      <div className="space-y-8">
        <Breadcrumbs />
        <TableSkeleton rows={5} cols={6} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Breadcrumbs />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>API Keys</h1>
          <p className="mt-1 text-muted-foreground">
            Manage API keys for your projects.
          </p>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setNewKey(null);
              setShowKey(false);
              setForm({ projectId: "", name: "" });
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              className="gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
              disabled={projects.length === 0}
            >
              <Plus className="h-4 w-4" />
              New Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {newKey ? (
              /* ── Key created screen ── */
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
                          onClick={() => copyKey(newKey.key)}
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
                      setDialogOpen(false);
                      setNewKey(null);
                      setShowKey(false);
                    }}
                  >
                    Done
                  </Button>
                </div>
              </>
            ) : (
              /* ── Create key form ── */
              <>
                <DialogHeader>
                  <DialogTitle>Create API Key</DialogTitle>
                  <DialogDescription>
                    The key will only be shown once after creation.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="project">Project</Label>
                    <select
                      id="project"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={form.projectId}
                      onChange={(e) =>
                        setForm({ ...form, projectId: e.target.value })
                      }
                      required
                    >
                      <option value="">Select a project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keyName">Key Name (optional)</Label>
                    <Input
                      id="keyName"
                      placeholder="production, staging, dev..."
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    disabled={creating}
                  >
                    {creating ? "Creating..." : "Create Key"}
                  </Button>
                </form>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* MCP note */}
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-cyan-500/5 border border-cyan-500/10">
        <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-cyan-400">MCP tip:</span> These API keys work with both the REST API and the{" "}
          <a
            href="https://docs.styx.sh/docs/mcp-server"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline hover:text-cyan-300"
          >
            Styx MCP server
          </a>
          . Set <code className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] font-mono text-cyan-300">STYX_API_KEY</code> in your MCP config to connect AI tools like Claude Desktop and Cursor.
        </p>
      </div>

      {/* Keys table */}
      {keys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-xl bg-secondary p-4">
              <KeyRound className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No API keys yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {projects.length === 0
                ? "Create a project first, then generate API keys."
                : "Generate your first API key to start using the gateway."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>All Keys</CardTitle>
            <CardDescription>
              {keys.length} key{keys.length !== 1 ? "s" : ""} across{" "}
              {projects.length} project{projects.length !== 1 ? "s" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Project</TableHead>
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
                      {projectName(key.project_id)}
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
                          onClick={() => handleRevoke(key.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
