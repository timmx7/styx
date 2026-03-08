"use client";

import { useState, useEffect } from "react";
import {
    Webhook,
    Plus,
    Trash2,
    Activity,
    CheckCircle2,
    XCircle,
    RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
    getWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    testWebhook,
    getWebhookDeliveries,
} from "@/lib/api";
import type { WebhookEndpoint, WebhookDelivery } from "@/lib/types";
import { toast } from "sonner";

interface WebhooksTabProps {
    teamId: string;
}

const AVAILABLE_EVENTS = [
    { id: "budget.exceeded", label: "Budget Exceeded" },
    { id: "api_key.created", label: "API Key Created" },
    { id: "project.created", label: "Project Created" },
];

export function WebhooksTab({ teamId }: WebhooksTabProps) {
    const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
    const [loading, setLoading] = useState(true);

    // Create Modal State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newUrl, setNewUrl] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
    const [creating, setCreating] = useState(false);
    const [createdSecret, setCreatedSecret] = useState<string | null>(null);

    // Deliveries Modal State
    const [isDeliveriesOpen, setIsDeliveriesOpen] = useState(false);
    const [selectedWebhook, setSelectedWebhook] = useState<WebhookEndpoint | null>(
        null
    );
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
    const [loadingDeliveries, setLoadingDeliveries] = useState(false);

    // Delete State
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        loadWebhooks();
    }, []);

    const loadWebhooks = async () => {
        try {
            setLoading(true);
            const data = await getWebhooks();
            setWebhooks(data);
        } catch {
            toast.error("Failed to load webhooks");
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newUrl.trim() || selectedEvents.length === 0) {
            toast.error("URL and at least one event are required");
            return;
        }

        try {
            setCreating(true);
            const webhook = await createWebhook({
                team_id: teamId,
                url: newUrl.trim(),
                description: newDescription.trim() || undefined,
                events: selectedEvents,
            });

            setCreatedSecret(webhook.secret || null);
            await loadWebhooks();

            // Reset form but keep modal open to show secret
            setNewUrl("");
            setNewDescription("");
            setSelectedEvents([]);
            toast.success("Webhook created successfully");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create webhook");
        } finally {
            setCreating(false);
        }
    };

    const closeCreateModal = () => {
        setIsCreateOpen(false);
        setCreatedSecret(null);
        setNewUrl("");
        setNewDescription("");
        setSelectedEvents([]);
    };

    const handleToggleActive = async (id: string, currentStatus: boolean) => {
        try {
            await updateWebhook(id, { is_active: !currentStatus });
            toast.success(`Webhook ${!currentStatus ? "enabled" : "disabled"}`);
            await loadWebhooks();
        } catch {
            toast.error("Failed to update webhook status");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this webhook?")) return;
        try {
            setDeletingId(id);
            await deleteWebhook(id);
            toast.success("Webhook deleted");
            await loadWebhooks();
        } catch {
            toast.error("Failed to delete webhook");
        } finally {
            setDeletingId(null);
        }
    };

    const handleTest = async (id: string) => {
        try {
            await testWebhook(id);
            toast.success("Test event sent successfully");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to send test event");
        }
    };

    const openDeliveries = async (webhook: WebhookEndpoint) => {
        setSelectedWebhook(webhook);
        setIsDeliveriesOpen(true);
        setLoadingDeliveries(true);
        try {
            const data = await getWebhookDeliveries(webhook.id);
            setDeliveries(data);
        } catch {
            toast.error("Failed to load delivery history");
        } finally {
            setLoadingDeliveries(false);
        }
    };

    if (loading) {
        return (
            <Card className="border-border/50">
                <CardContent className="flex h-48 items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">Webhook Endpoints</h3>
                    <p className="text-sm text-muted-foreground">
                        Receive real-time HTTP callbacks when events happen in your team.
                    </p>
                </div>
                <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Webhook
                </Button>
            </div>

            <Card className="border-border/50">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>URL</TableHead>
                            <TableHead>Events</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Last Triggered</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {webhooks.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                    No webhooks configured yet.
                                </TableCell>
                            </TableRow>
                        ) : (
                            webhooks.map((webhook) => (
                                <TableRow key={webhook.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col gap-1">
                                            <span className="truncate max-w-[250px]">{webhook.url}</span>
                                            {webhook.description && (
                                                <span className="text-xs text-muted-foreground truncate max-w-[250px]">
                                                    {webhook.description}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {webhook.events.slice(0, 2).map((event) => (
                                                <Badge key={event} variant="secondary" className="text-xs">
                                                    {event}
                                                </Badge>
                                            ))}
                                            {webhook.events.length > 2 && (
                                                <Badge variant="secondary" className="text-xs">
                                                    +{webhook.events.length - 2} more
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={webhook.is_active}
                                                onCheckedChange={() =>
                                                    handleToggleActive(webhook.id, webhook.is_active)
                                                }
                                            />
                                            {webhook.consecutive_failures > 0 && webhook.is_active && (
                                                <Badge variant="destructive" className="text-[10px] h-5 px-1.5 ml-1">
                                                    {webhook.consecutive_failures} fails
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {webhook.last_triggered_at
                                            ? new Date(webhook.last_triggered_at).toLocaleString()
                                            : "Never"}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openDeliveries(webhook)}
                                                title="View Deliveries"
                                            >
                                                <Activity className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleTest(webhook.id)}
                                                disabled={!webhook.is_active}
                                                title="Send Test Event"
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => handleDelete(webhook.id)}
                                                disabled={deletingId === webhook.id}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </Card>

            {/* Create Webhook Modal */}
            <Dialog open={isCreateOpen} onOpenChange={(open) => !open && closeCreateModal()}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Add Webhook Endpoint</DialogTitle>
                        <DialogDescription>
                            We&apos;ll send POST requests to this URL when selected events occur.
                        </DialogDescription>
                    </DialogHeader>

                    {createdSecret ? (
                        <div className="space-y-4 py-4">
                            <div className="rounded-lg bg-green-500/10 p-4 border border-green-500/20">
                                <div className="flex items-center gap-2 text-green-600 mb-2">
                                    <CheckCircle2 className="h-5 w-5" />
                                    <p className="font-semibold">Webhook created successfully!</p>
                                </div>
                                <p className="text-sm text-green-600/80 mb-4">
                                    Please copy this webhook secret. You won&apos;t be able to see it again.
                                    Use it to verify the <code className="bg-green-500/20 px-1 py-0.5 rounded">X-Styx-Signature</code> header.
                                </p>
                                <div className="flex items-center gap-2">
                                    <Input readOnly value={createdSecret} className="font-mono bg-background" />
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            navigator.clipboard.writeText(createdSecret);
                                            toast.success("Secret copied to clipboard");
                                        }}
                                    >
                                        Copy
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="url">Endpoint URL</Label>
                                <Input
                                    id="url"
                                    placeholder="https://api.yourdomain.com/webhooks/styx"
                                    value={newUrl}
                                    onChange={(e) => setNewUrl(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description">Description (Optional)</Label>
                                <Input
                                    id="description"
                                    placeholder="Production billing alerts"
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                />
                            </div>
                            <div className="space-y-3 pt-2">
                                <Label>Events to send</Label>
                                <div className="grid gap-2 border rounded-md p-4 bg-muted/30">
                                    {AVAILABLE_EVENTS.map((event) => (
                                        <div key={event.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`event-${event.id}`}
                                                checked={selectedEvents.includes(event.id)}
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        setSelectedEvents([...selectedEvents, event.id]);
                                                    } else {
                                                        setSelectedEvents(
                                                            selectedEvents.filter((id) => id !== event.id)
                                                        );
                                                    }
                                                }}
                                            />
                                            <Label
                                                htmlFor={`event-${event.id}`}
                                                className="text-sm font-normal cursor-pointer"
                                            >
                                                {event.label} <span className="text-muted-foreground">({event.id})</span>
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        {createdSecret ? (
                            <Button onClick={closeCreateModal}>Done</Button>
                        ) : (
                            <>
                                <Button variant="outline" onClick={closeCreateModal} disabled={creating}>
                                    Cancel
                                </Button>
                                <Button onClick={handleCreate} disabled={creating || !newUrl.trim() || selectedEvents.length === 0}>
                                    {creating ? "Creating..." : "Create Webhook"}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Deliveries Modal */}
            <Dialog open={isDeliveriesOpen} onOpenChange={setIsDeliveriesOpen}>
                <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            Delivery History
                        </DialogTitle>
                        <DialogDescription className="truncate">
                            Recent events sent to {selectedWebhook?.url}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto pr-2 min-h-[300px]">
                        {loadingDeliveries ? (
                            <div className="flex h-full items-center justify-center py-12">
                                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : deliveries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <Webhook className="h-10 w-10 mb-2 opacity-20" />
                                <p>No deliveries recorded yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {deliveries.map((delivery) => (
                                    <div key={delivery.id} className="border rounded-lg p-3 text-sm">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                {delivery.success ? (
                                                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-destructive" />
                                                )}
                                                <span className="font-semibold">{delivery.event_type}</span>
                                                <span className="text-muted-foreground text-xs">
                                                    {new Date(delivery.created_at).toLocaleString()}
                                                </span>
                                            </div>
                                            <Badge variant={delivery.success ? "secondary" : "destructive"}>
                                                {delivery.response_status || "Failed"}
                                            </Badge>
                                        </div>

                                        <div className="mt-2 text-xs">
                                            <p className="text-muted-foreground mb-1 font-medium">Payload:</p>
                                            <pre className="bg-muted p-2 rounded overflow-x-auto">
                                                {JSON.stringify(delivery.payload, null, 2)}
                                            </pre>
                                        </div>

                                        {!delivery.success && delivery.response_body && (
                                            <div className="mt-2 text-xs">
                                                <p className="text-muted-foreground mb-1 font-medium">Error Response:</p>
                                                <pre className="bg-destructive/10 text-destructive p-2 rounded overflow-x-auto">
                                                    {delivery.response_body}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
