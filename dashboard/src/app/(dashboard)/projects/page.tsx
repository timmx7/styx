"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FolderKanban } from "lucide-react";
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
  getProjects,
  getTeams,
  createProject,
  createTeam,
} from "@/lib/api";
import type { Project, Team } from "@/lib/types";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardSkeleton } from "@/components/ui/skeleton";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    teamName: "",
    budget: "",
  });

  const fetchData = () => {
    Promise.all([getProjects(), getTeams()])
      .then(([p, t]) => {
        setProjects(p);
        setTeams(t);
      })
      .catch(() => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      // If no team exists, create one first
      let teamId: string;
      if (teams.length === 0) {
        const team = await createTeam(form.teamName || "Default Team");
        teamId = team.id;
      } else {
        teamId = teams[0].id;
      }

      await createProject({
        name: form.name,
        team_id: teamId,
        budget_monthly_cents: form.budget
          ? Math.round(parseFloat(form.budget) * 100)
          : undefined,
      });

      toast.success("Project created!");
      setDialogOpen(false);
      setForm({ name: "", teamName: "", budget: "" });
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <Breadcrumbs />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
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
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your API gateway projects.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new project</DialogTitle>
              <DialogDescription>
                Each project gets its own API keys, budget, and routing rules.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              {teams.length === 0 && (
                <div className="space-y-2">
                  <Label htmlFor="teamName">Team Name</Label>
                  <Input
                    id="teamName"
                    placeholder="My Team"
                    value={form.teamName}
                    onChange={(e) =>
                      setForm({ ...form, teamName: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    You need a team first. We&apos;ll create one for you.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="projectName">Project Name</Label>
                <Input
                  id="projectName"
                  placeholder="my-ai-app"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Monthly Budget (USD, optional)</Label>
                <Input
                  id="budget"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="100.00"
                  value={form.budget}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })}
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Projects grid */}
      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-xl bg-secondary p-4">
              <FolderKanban className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No projects yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to start routing API requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full border-border/50 transition-colors hover:border-foreground/20 cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge className="bg-foreground/5 text-foreground hover:bg-foreground/10">
                      {project.routing_strategy}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">
                    {project.id.slice(0, 8)}...
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Budget</span>
                    <span className="font-medium">
                      {project.budget_monthly_cents
                        ? `$${(project.budget_monthly_cents / 100).toFixed(2)}/mo`
                        : "Unlimited"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Providers</span>
                    <span className="font-medium">
                      {project.allowed_providers?.join(", ") || "All"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Created</span>
                    <span className="font-medium">
                      {new Date(project.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
