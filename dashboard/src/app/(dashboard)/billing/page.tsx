"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  getSubscription,
  getCreditBalance,
  getCreditTransactions,
  getModelPricing,
  purchaseCredits,
  createCheckoutSession,
  createPortalSession,
  getBudgets,
} from "@/lib/api";
import type {
  Subscription,
  CreditBalance,
  CreditTransaction,
  ModelPricing,
  BudgetStatus,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Key,
  Zap,
  CreditCard,
  DollarSign,
  ArrowUpRight,
  TrendingUp,
  Gauge,
  Check,
  Coins,
  Settings,
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CardSkeleton, StatsGridSkeleton } from "@/components/ui/skeleton";

// ─── Helpers ────────────────────────────────────────────────────────

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ─── Charon plans for upgrade cards ─────────────────────────────────

const CHARON_PLANS = [
  { key: "shade", name: "Shade", price: 0, limit: 10_000, features: ["10K requests/mo", "BYOK", "Community support"] },
  { key: "obol", name: "Obol", price: 1_900, limit: 100_000, features: ["100K requests/mo", "Smart routing", "Email support"] },
  { key: "ferryman", name: "Ferryman", price: 7_900, limit: 500_000, features: ["500K requests/mo", "Semantic cache", "Priority support"] },
  { key: "titan", name: "Titan", price: 24_900, limit: 5_000_000, features: ["5M requests/mo", "Full features", "SLA + Dedicated support"] },
];

// ─── Credit packs ───────────────────────────────────────────────────

const CREDIT_PACKS = [
  { cents: 1_000, label: "$10" },
  { cents: 5_000, label: "$50" },
  { cents: 20_000, label: "$200" },
];


// ═════════════════════════════════════════════════════════════════════

export default function BillingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Shared state
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Achilles-specific state
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([]);

  // ─── Redirect if no billing mode ──────────────────────────────────

  useEffect(() => {
    if (!authLoading && user && !user.billing_mode) {
      router.replace("/onboarding");
    }
  }, [authLoading, user, router]);

  // ─── Load data based on billing mode ──────────────────────────────

  useEffect(() => {
    if (!user?.billing_mode) return;

    const loadData = async () => {
      try {
        const [sub, bud] = await Promise.all([
          getSubscription(),
          getBudgets(),
        ]);
        setSubscription(sub);
        setBudgets(bud);

        if (user.billing_mode === "achilles") {
          const [bal, txns, pricing] = await Promise.all([
            getCreditBalance(),
            getCreditTransactions(20),
            getModelPricing(),
          ]);
          setCreditBalance(bal);
          setTransactions(txns);
          setModelPricing(pricing);
        }
      } catch {
        setError("Failed to load billing data.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user?.billing_mode]);

  // ─── Actions ──────────────────────────────────────────────────────

  const handleUpgrade = async (plan: string) => {
    if (!user?.billing_mode) return;
    setActionLoading(`upgrade-${plan}`);
    try {
      const { url } = await createCheckoutSession(user.billing_mode, plan);
      window.location.href = url;
    } catch {
      setError("Failed to start checkout.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    setActionLoading("portal");
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch {
      setError("Failed to open billing portal.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleBuyCredits = async (amountCents: number) => {
    setActionLoading(`buy-${amountCents}`);
    try {
      const result = await purchaseCredits(amountCents);
      if ("url" in result) {
        window.location.href = result.url;
      } else {
        // Mock mode — credits added directly
        const bal = await getCreditBalance();
        setCreditBalance(bal);
        const txns = await getCreditTransactions(20);
        setTransactions(txns);
      }
    } catch {
      setError("Failed to purchase credits.");
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Loading / redirect states ────────────────────────────────────

  if (authLoading || (!user?.billing_mode && !loading)) {
    return (
      <div className="space-y-8">
        <Breadcrumbs />
        <StatsGridSkeleton count={3} className="grid gap-4 md:grid-cols-3" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <Breadcrumbs />
        <StatsGridSkeleton count={3} className="grid gap-4 md:grid-cols-3" />
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  const billingMode = user?.billing_mode;

  // ═════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-8">
      <Breadcrumbs />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Billing</h1>
          <p className="text-muted-foreground">
            {billingMode === "charon"
              ? "Manage your plan and request quota."
              : "Manage your credit balance and usage."}
          </p>
        </div>
        <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1.5">
          {billingMode === "charon" ? (
            <Key className="h-3.5 w-3.5" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          {billingMode === "charon" ? "Charon (BYOK)" : "Achilles (Managed)"}
        </Badge>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ═══ CHARON VIEW ═══════════════════════════════════════════════ */}
      {billingMode === "charon" && subscription && (
        <>
          {/* Stats row */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold capitalize">
                  {subscription.plan}
                </div>
                <p className="text-xs text-muted-foreground">
                  {subscription.status === "active" ? "Active" : subscription.status}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Requests Used</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fmtNumber(subscription.requests_used)}
                </div>
                <p className="text-xs text-muted-foreground">
                  of {fmtNumber(subscription.requests_limit)} this month
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Quota Usage</CardTitle>
                <Gauge className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {subscription.requests_limit > 0
                    ? `${((subscription.requests_used / subscription.requests_limit) * 100).toFixed(1)}%`
                    : "0%"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {subscription.requests_limit - subscription.requests_used > 0
                    ? `${fmtNumber(subscription.requests_limit - subscription.requests_used)} remaining`
                    : "Quota exceeded"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Request usage bar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Request Usage</CardTitle>
              <CardDescription>
                {fmtNumber(subscription.requests_used)} / {fmtNumber(subscription.requests_limit)} requests
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-4 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full transition-all ${
                    subscription.requests_used >= subscription.requests_limit
                      ? "bg-destructive"
                      : subscription.requests_used >= subscription.requests_limit * 0.8
                        ? "bg-yellow-500"
                        : "bg-primary"
                  }`}
                  style={{
                    width: `${Math.min(
                      (subscription.requests_used / Math.max(subscription.requests_limit, 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{fmtNumber(subscription.requests_limit)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Plan cards */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Plans</h2>
              <Button variant="outline" size="sm" onClick={handleManageSubscription} disabled={actionLoading === "portal"}>
                <Settings className="mr-2 h-4 w-4" />
                {actionLoading === "portal" ? "Opening..." : "Manage Subscription"}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              {CHARON_PLANS.map((plan) => {
                const isCurrent = subscription.plan === plan.key;
                const isUpgrade = !isCurrent && plan.price > (CHARON_PLANS.find((p) => p.key === subscription.plan)?.price ?? 0);
                return (
                  <Card
                    key={plan.key}
                    className={isCurrent ? "border-primary shadow-md" : "border-border"}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{plan.name}</CardTitle>
                        {isCurrent && <Badge variant="default">Current</Badge>}
                      </div>
                      <CardDescription>
                        {plan.price === 0 ? "Free" : `${fmt(plan.price)}/mo`}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-1.5">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      {!isCurrent && (
                        <Button
                          className="w-full"
                          size="sm"
                          variant={isUpgrade ? "default" : "outline"}
                          disabled={actionLoading !== null}
                          onClick={() => handleUpgrade(plan.key)}
                        >
                          {actionLoading === `upgrade-${plan.key}`
                            ? "Redirecting..."
                            : isUpgrade
                              ? "Upgrade"
                              : "Change Plan"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══ ACHILLES VIEW ═════════════════════════════════════════════ */}
      {billingMode === "achilles" && creditBalance && (
        <>
          {/* Stats row */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Credit Balance</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">
                  {fmt(creditBalance.balance_cents)}
                </div>
                <p className="text-xs text-muted-foreground">Available credits</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Purchased</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fmt(creditBalance.total_purchased_cents)}
                </div>
                <p className="text-xs text-muted-foreground">Lifetime purchases</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Consumed</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {fmt(creditBalance.total_consumed_cents)}
                </div>
                <p className="text-xs text-muted-foreground">Lifetime usage</p>
              </CardContent>
            </Card>
          </div>

          {/* Buy credits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Buy Credits</CardTitle>
              <CardDescription>
                Purchase prepaid credits to use with managed API access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {CREDIT_PACKS.map((pack) => (
                  <Button
                    key={pack.cents}
                    variant="outline"
                    className="min-w-[120px]"
                    disabled={actionLoading !== null}
                    onClick={() => handleBuyCredits(pack.cents)}
                  >
                    {actionLoading === `buy-${pack.cents}` ? (
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Buying...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <ArrowUpRight className="h-4 w-4" />
                        {pack.label}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Model pricing */}
          {modelPricing.length > 0 && (
            <div>
              <h2 className="mb-4 text-xl font-semibold">Model Pricing</h2>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-4 py-3 text-left font-medium">Model</th>
                          <th className="px-4 py-3 text-left font-medium">Provider</th>
                          <th className="px-4 py-3 text-right font-medium">Input (per 1M tokens)</th>
                          <th className="px-4 py-3 text-right font-medium">Output (per 1M tokens)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelPricing
                          .filter((m) => m.is_active)
                          .map((m) => (
                            <tr key={`${m.provider}-${m.model}`} className="border-b last:border-b-0">
                              <td className="px-4 py-3 font-medium">{m.display_name}</td>
                              <td className="px-4 py-3 text-muted-foreground capitalize">
                                {m.provider}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs">
                                ${m.input_price_per_million.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-xs">
                                ${m.output_price_per_million.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Recent transactions */}
          {transactions.length > 0 && (
            <div>
              <h2 className="mb-4 text-xl font-semibold">Recent Transactions</h2>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-4 py-3 text-left font-medium">Date</th>
                          <th className="px-4 py-3 text-left font-medium">Type</th>
                          <th className="px-4 py-3 text-left font-medium">Description</th>
                          <th className="px-4 py-3 text-right font-medium">Amount</th>
                          <th className="px-4 py-3 text-right font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((tx) => (
                          <tr key={tx.id} className="border-b last:border-b-0">
                            <td className="px-4 py-3 text-muted-foreground">
                              {new Date(tx.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                variant={tx.type === "purchase" || tx.type === "bonus" ? "default" : "secondary"}
                              >
                                {tx.type}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {tx.description || "—"}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono text-xs ${
                                tx.amount_cents >= 0 ? "text-green-500" : "text-destructive"
                              }`}
                            >
                              {tx.amount_cents >= 0 ? "+" : ""}
                              {fmt(tx.amount_cents)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {fmt(tx.balance_after_cents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ═══ SHARED: Project Budgets ═══════════════════════════════════ */}
      {budgets.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="mb-4 text-xl font-semibold">Project Budgets</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {budgets.map((b) => (
                <Card key={b.project_id}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-base">{b.project_name}</CardTitle>
                      <CardDescription>
                        {b.budget_cents
                          ? `Budget: ${fmt(b.budget_cents)}/mo`
                          : "No budget limit"}
                      </CardDescription>
                    </div>
                    <Gauge className="h-5 w-5 text-muted-foreground" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Spent: {fmt(b.spent_cents)}
                        </span>
                        <span
                          className={
                            b.pct_used >= 100
                              ? "font-semibold text-destructive"
                              : b.pct_used >= b.alert_threshold_pct
                                ? "font-semibold text-yellow-500"
                                : "text-muted-foreground"
                          }
                        >
                          {b.budget_cents ? `${b.pct_used.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                      {b.budget_cents && (
                        <div className="h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all ${
                              b.pct_used >= 100
                                ? "bg-destructive"
                                : b.pct_used >= b.alert_threshold_pct
                                  ? "bg-yellow-500"
                                  : "bg-primary"
                            }`}
                            style={{ width: `${Math.min(b.pct_used, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Alert threshold: {b.alert_threshold_pct}%</span>
                      {b.remaining_cents !== null && (
                        <span>Remaining: {fmt(b.remaining_cents)}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
