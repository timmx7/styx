"use client";

import { useState } from "react";
import { Plus, Trash2, Edit2, Play, Square, Split } from "lucide-react";
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
import { toast } from "sonner";
import {
    ABTestExperiment,
    ABTestVariant,
} from "@/lib/types";
import { createABTest, deleteABTest, updateABTest } from "@/lib/api";

interface ABTestingListProps {
    projectId: string;
    experiments: ABTestExperiment[];
    onUpdate: () => void;
}

export function ABTestingList({ projectId, experiments, onUpdate }: ABTestingListProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingExp, setEditingExp] = useState<ABTestExperiment | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [isActive, setIsActive] = useState(false);
    const [variants, setVariants] = useState<ABTestVariant[]>([
        { id: "control", provider: "openai", model: "gpt-4o", weight: 50 },
        { id: "test", provider: "anthropic", model: "claude-sonnet-4-20250514", weight: 50 },
    ]);

    const openCreateDialog = () => {
        setEditingExp(null);
        setName("");
        setIsActive(false);
        setVariants([
            { id: "control", provider: "openai", model: "gpt-4o", weight: 50 },
            { id: "test", provider: "anthropic", model: "claude-sonnet-4-20250514", weight: 50 },
        ]);
        setDialogOpen(true);
    };

    const openEditDialog = (exp: ABTestExperiment) => {
        setEditingExp(exp);
        setName(exp.name);
        setIsActive(exp.is_active);
        setVariants([...exp.variants]);
        setDialogOpen(true);
    };

    const addVariant = () => {
        setVariants([
            ...variants,
            { id: `variant-${variants.length + 1}`, provider: "openai", model: "gpt-4o", weight: 0 },
        ]);
    };

    const updateVariant = (index: number, field: keyof ABTestVariant, value: string | number) => {
        const newVariants = [...variants];
        newVariants[index] = { ...newVariants[index], [field]: value };
        setVariants(newVariants);
    };

    const removeVariant = (index: number) => {
        setVariants(variants.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const totalWeight = variants.reduce((acc, v) => acc + (Number(v.weight) || 0), 0);
        if (totalWeight !== 100) {
            toast.error(`Total weight must be 100 (currently ${totalWeight})`);
            return;
        }

        setIsSubmitting(true);
        try {
            if (editingExp) {
                await updateABTest(projectId, editingExp.id, {
                    name,
                    is_active: isActive,
                    variants: variants.map(v => ({ ...v, weight: Number(v.weight) })),
                });
                toast.success("A/B test updated");
            } else {
                await createABTest(projectId, {
                    name,
                    is_active: isActive,
                    variants: variants.map(v => ({ ...v, weight: Number(v.weight) })),
                });
                toast.success("A/B test created");
            }
            setDialogOpen(false);
            onUpdate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save A/B test");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this A/B test?")) return;
        try {
            await deleteABTest(projectId, id);
            toast.success("A/B test deleted");
            onUpdate();
        } catch {
            toast.error("Failed to delete A/B test");
        }
    };

    const handleToggleActive = async (exp: ABTestExperiment) => {
        try {
            await updateABTest(projectId, exp.id, {
                is_active: !exp.is_active,
            });
            toast.success(`Experiment ${exp.is_active ? "paused" : "activated"}`);
            onUpdate();
        } catch {
            toast.error("Failed to update status");
        }
    };

    return (
        <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Split className="h-5 w-5 text-primary" />
                        A/B Testing (Evals)
                    </CardTitle>
                    <CardDescription>
                        Route traffic between different models to compare latency, cost, and quality.
                    </CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90" onClick={openCreateDialog}>
                            <Plus className="h-4 w-4" />
                            New Experiment
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{editingExp ? "Edit A/B Test" : "Create A/B Test"}</DialogTitle>
                            <DialogDescription>
                                Configure traffic split across multiple models. Total weight must equal 100.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="expName">Experiment Name</Label>
                                <Input
                                    id="expName"
                                    placeholder="e.g., GPT-4o vs Claude 3.5"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label>Variants (Traffic Split)</Label>
                                    <Button type="button" variant="outline" size="sm" onClick={addVariant} className="h-8">
                                        <Plus className="h-4 w-4 mr-1" /> Add Variant
                                    </Button>
                                </div>
                                {variants.map((variant, index) => (
                                    <div key={index} className="flex items-start gap-2 p-3 border rounded-md bg-secondary/50">
                                        <div className="grid flex-1 grid-cols-12 gap-2">
                                            <div className="col-span-3 space-y-1">
                                                <Label className="text-xs">Variant ID</Label>
                                                <Input
                                                    value={variant.id}
                                                    onChange={(e) => updateVariant(index, "id", e.target.value)}
                                                    placeholder="control"
                                                    required
                                                />
                                            </div>
                                            <div className="col-span-3 space-y-1">
                                                <Label className="text-xs">Provider</Label>
                                                <Input
                                                    value={variant.provider}
                                                    onChange={(e) => updateVariant(index, "provider", e.target.value)}
                                                    placeholder="openai"
                                                    required
                                                />
                                            </div>
                                            <div className="col-span-4 space-y-1">
                                                <Label className="text-xs">Model</Label>
                                                <Input
                                                    value={variant.model}
                                                    onChange={(e) => updateVariant(index, "model", e.target.value)}
                                                    placeholder="gpt-4o"
                                                    required
                                                />
                                            </div>
                                            <div className="col-span-2 space-y-1">
                                                <Label className="text-xs">Weight (%)</Label>
                                                <Input
                                                    type="number"
                                                    value={variant.weight}
                                                    onChange={(e) => updateVariant(index, "weight", e.target.value)}
                                                    min="0"
                                                    max="100"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        {variants.length > 2 && (
                                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 mt-6 text-muted-foreground hover:text-destructive" onClick={() => removeVariant(index)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Button type="submit" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? "Saving..." : "Save Experiment"}
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {experiments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Split className="h-6 w-6 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">
                            No A/B tests configured. Set one up to start evaluating models.
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Experiment Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Variants</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {experiments.map((exp) => (
                                <TableRow key={exp.id}>
                                    <TableCell className="font-medium">{exp.name}</TableCell>
                                    <TableCell>
                                        {exp.is_active ? (
                                            <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15">
                                                <Play className="h-3 w-3 mr-1" /> Active
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="text-muted-foreground">
                                                <Square className="h-3 w-3 mr-1" /> Paused
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            {exp.variants.map((v) => (
                                                <span key={v.id} className="text-xs text-muted-foreground">
                                                    <strong>{v.weight}%</strong> - {v.provider}/{v.model} ({v.id})
                                                </span>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {new Date(exp.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleActive(exp)} title={exp.is_active ? "Pause" : "Activate"}>
                                            {exp.is_active ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(exp)} title="Edit">
                                            <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(exp.id)} className="text-muted-foreground hover:text-destructive" title="Delete">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
