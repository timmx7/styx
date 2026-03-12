"use client";

import { useEffect, useState } from "react";
import { getAlerts, markAlertRead, markAllAlertsRead } from "@/lib/api";
import type { Alert } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  BellOff,
  CheckCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  Filter,
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardSkeleton, StatsGridSkeleton } from "@/components/ui/skeleton";

function severityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-500" />;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20">
          Warning
        </Badge>
      );
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
}


export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAlerts(100, unreadOnly)
      .then(setAlerts)
      .catch(() => {
        setError("Failed to load alerts. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [unreadOnly]);

  const handleMarkRead = async (id: string) => {
    await markAlertRead(id);
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_read: true } : a))
    );
  };

  const handleMarkAllRead = async () => {
    await markAllAlertsRead();
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
  };

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <StatsGridSkeleton count={3} className="grid gap-4 md:grid-cols-3" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Alerts</h1>
          <p className="text-muted-foreground">
            Budget warnings and system notifications.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={unreadOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            <Filter className="mr-2 h-4 w-4" />
            {unreadOnly ? "Showing unread" : "Show all"}
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg p-4 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }} role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              getAlerts(100, unreadOnly)
                .then(setAlerts)
                .catch(() => {
                  setError("Failed to load alerts. Please try again.");
                })
                .finally(() => setLoading(false));
            }}
            className="mt-2 text-xs underline hover:text-red-500"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Total Alerts
            </CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alerts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Unread</CardTitle>
            <BellOff className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unreadCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Critical
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {alerts.filter((a) => a.severity === "critical").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alert List */}
      {alerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bell className="mb-4 h-12 w-12 opacity-30" />
            <p className="text-lg font-medium">No alerts</p>
            <p className="text-sm">
              {unreadOnly
                ? "All alerts have been read."
                : "No alerts have been generated yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card
              key={alert.id}
              className={
                alert.is_read
                  ? "opacity-60"
                  : "border-l-4 border-l-primary"
              }
            >
              <CardContent className="flex items-start gap-4 py-4">
                <div className="mt-0.5">{severityIcon(alert.severity)}</div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3
                      className={`text-sm font-semibold ${
                        alert.is_read ? "" : "text-foreground"
                      }`}
                    >
                      {alert.title}
                    </h3>
                    {severityBadge(alert.severity)}
                    <Badge variant="outline" className="text-xs">
                      {alert.alert_type.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {alert.message}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                    {alert.spent_cents !== null &&
                      alert.budget_cents !== null && (
                        <span>
                          Spent: ${(alert.spent_cents / 100).toFixed(2)} /{" "}
                          ${(alert.budget_cents / 100).toFixed(2)}
                        </span>
                      )}
                  </div>
                </div>

                {!alert.is_read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMarkRead(alert.id)}
                    className="shrink-0"
                  >
                    Mark read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
