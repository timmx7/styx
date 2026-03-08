"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { getPrompts, getProjects, createPrompt, updatePrompt, deletePrompt } from "@/lib/api";
import type { PromptTemplate, Project } from "@/lib/types";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Bot, Plus, Sparkles, Play } from "lucide-react";

export default function PromptsPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>("");
    const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
    const [loading, setLoading] = useState(true);

    // Dialog states
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(null);

    // Form states
    const [name, setName] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isActive, setIsActive] = useState(false);

    useEffect(() => {
        getProjects()
            .then((p) => {
                setProjects(p);
                if (p.length > 0) {
                    setSelectedProject(p[0].id);
                    fetchPrompts(p[0].id);
                } else {
                    setLoading(false);
                }
            })
            .catch(() => {
                toast.error("Failed to load projects");
                setLoading(false);
            });
    }, []);

    const fetchPrompts = async (projectId: string) => {
        setLoading(true);
        try {
            const data = await getPrompts(projectId);
            setPrompts(data);
        } catch (err) {
            toast.error("Failed to load prompts");
            Sentry.captureException(err);
        } finally {
            setLoading(false);
        }
    };

    const handleProjectChange = (val: string) => {
        setSelectedProject(val);
        fetchPrompts(val);
    };

    const openCreateDialog = () => {
        setEditingPrompt(null);
        setName("");
        setSystemPrompt("");
        setIsActive(false);
        setIsDialogOpen(true);
    };

    const openEditDialog = (prompt: PromptTemplate) => {
        setEditingPrompt(prompt);
        setName(prompt.name);
        setSystemPrompt(prompt.system_prompt);
        setIsActive(prompt.is_active);
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        if (!selectedProject) return;
        if (!name || !systemPrompt) {
            toast.error("Name and System Prompt are required");
            return;
        }

        try {
            if (editingPrompt) {
                await updatePrompt(selectedProject, editingPrompt.id, {
                    name,
                    system_prompt: systemPrompt,
                    is_active: isActive,
                });
                toast.success("Prompt updated");
            } else {
                await createPrompt(selectedProject, {
                    name,
                    system_prompt: systemPrompt,
                    is_active: isActive,
                });
                toast.success("Prompt created");
            }
            setIsDialogOpen(false);
            fetchPrompts(selectedProject);
        } catch (err: unknown) {
            const e = err as Error;
            toast.error(e.message || "Failed to save prompt");
        }
    };

    const handleDelete = async (id: string) => {
        if (!selectedProject) return;
        if (!confirm("Are you sure you want to delete this prompt?")) return;

        try {
            await deletePrompt(selectedProject, id);
            toast.success("Prompt deleted");
            fetchPrompts(selectedProject);
        } catch (err: unknown) {
            const e = err as Error;
            toast.error(e.message || "Failed to delete prompt");
        }
    };

    const toggleActive = async (prompt: PromptTemplate) => {
        if (!selectedProject) return;
        try {
            await updatePrompt(selectedProject, prompt.id, {
                is_active: !prompt.is_active,
            });
            toast.success(prompt.is_active ? "Prompt deactivated" : "Prompt activated");
            fetchPrompts(selectedProject);
        } catch (err: unknown) {
            const e = err as Error;
            toast.error(e.message || "Failed to update prompt status");
        }
    };

    return (
        <div className="space-y-8 pb-10">
            <Breadcrumbs />

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Prompt Playground</h1>
                    <p className="mt-1 text-muted-foreground max-w-2xl">
                        Test and manage dynamic system prompts across all your selected AI providers without changing your backend code.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Select value={selectedProject} onValueChange={handleProjectChange}>
                        <SelectTrigger className="w-[200px] sm:w-[250px]">
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
            </div>

            {!selectedProject && !loading && (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center h-48 text-center">
                        <Bot className="h-10 w-10 text-muted-foreground/40 mb-4" />
                        <h3 className="text-lg font-medium">No Project Selected</h3>
                        <p className="text-muted-foreground mt-1 max-w-sm">Please select or create a project to manage Prompts.</p>
                    </CardContent>
                </Card>
            )}

            {selectedProject && (
                <>
                    <div className="flex justify-end">
                        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                            <DialogTrigger asChild>
                                <Button onClick={openCreateDialog} className="gap-2" style={{ backgroundColor: "#1400FF", color: "white" }}>
                                    <Plus className="h-4 w-4" />
                                    Create Prompt
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[600px]">
                                <DialogHeader>
                                    <DialogTitle>{editingPrompt ? "Edit Prompt" : "Create New Prompt"}</DialogTitle>
                                    <DialogDescription>
                                        Define the system instructions that will optionally override the default prompts.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="name">Prompt Name</Label>
                                        <Input
                                            id="name"
                                            placeholder="e.g. Chatbot Strict Mode"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="system_prompt">System Prompt</Label>
                                        <textarea
                                            id="system_prompt"
                                            className="flex min-h-[200px] w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                                            placeholder="You are a helpful assistant..."
                                            value={systemPrompt}
                                            onChange={(e) => setSystemPrompt(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex items-center space-x-2 pt-2">
                                        <input
                                            type="checkbox"
                                            id="is_active"
                                            checked={isActive}
                                            onChange={(e) => setIsActive(e.target.checked)}
                                            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                        />
                                        <Label htmlFor="is_active" className="text-sm font-medium leading-none">
                                            Set as active for this project (overrides code)
                                        </Label>
                                    </div>
                                </div>
                                <div className="flex justify-end pt-4 border-t border-border gap-3">
                                    <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button onClick={handleSave} style={{ backgroundColor: "#1400FF", color: "white" }}>
                                        {editingPrompt ? "Save Changes" : "Create Prompt"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    {loading ? (
                        <div className="flex flex-col gap-4">
                            {[1, 2, 3].map(i => (
                                <Card key={i} className="animate-pulse h-32" />
                            ))}
                        </div>
                    ) : prompts.length === 0 ? (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="h-12 w-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(20,0,255,0.06)" }}>
                                    <Sparkles className="h-6 w-6" style={{ color: "#1400FF" }} />
                                </div>
                                <h3 className="text-xl font-medium mb-2">No Prompts Created</h3>
                                <p className="text-muted-foreground max-w-md mx-auto mb-6">
                                    Build and test system instructions. Once active, the Go proxy router will inject them instantly into OpenAI and Anthropic API calls.
                                </p>
                                <Button onClick={openCreateDialog} variant="outline">
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add First Prompt
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {prompts.map((prompt) => (
                                <Card key={prompt.id} className={`flex flex-col transition-all cursor-default ${prompt.is_active ? 'relative overflow-hidden' : ''}`} style={prompt.is_active ? { border: "1px solid rgba(20,0,255,0.3)" } : undefined}>

                                    {/* Status Indicator Bar */}
                                    {prompt.is_active && (
                                        <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: "#1400FF" }} />
                                    )}

                                    <CardHeader className="flex flex-row items-start justify-between pb-2">
                                        <div>
                                            <CardTitle className="text-lg font-medium flex items-center gap-2">
                                                {prompt.name}
                                                {prompt.is_active && (
                                                    <Badge className="border-none font-medium text-[10px] uppercase tracking-wider px-2 py-0" style={{ backgroundColor: "rgba(20,0,255,0.08)", color: "#1400FF" }}>Active</Badge>
                                                )}
                                            </CardTitle>
                                            <CardDescription className="text-xs mt-1">
                                                Updated {new Date(prompt.updated_at).toLocaleDateString()}
                                            </CardDescription>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="flex-1 flex flex-col">
                                        <div className="flex-1 bg-secondary border border-border rounded-md p-3 mb-4 mt-2 overflow-y-auto max-h-32 scrollbar-thin">
                                            <p className="text-sm font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                {prompt.system_prompt}
                                            </p>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-border">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className={`text-xs ${prompt.is_active ? 'text-amber-600 hover:text-amber-500 hover:bg-amber-500/10' : 'text-emerald-600 hover:text-emerald-500 hover:bg-emerald-500/10'}`}
                                                onClick={() => toggleActive(prompt)}
                                            >
                                                <Play className="w-3 h-3 mr-1.5" />
                                                {prompt.is_active ? "Deactivate" : "Set Active"}
                                            </Button>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-xs text-muted-foreground hover:text-foreground"
                                                    onClick={() => openEditDialog(prompt)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                    onClick={() => handleDelete(prompt.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
