"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setBillingMode } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If user already chose a billing mode, redirect to dashboard
  useEffect(() => {
    if (user?.billing_mode) {
      router.replace("/overview");
    }
  }, [user?.billing_mode, router]);

  if (user?.billing_mode) {
    return null;
  }

  const handleChoice = async (mode: "charon" | "achilles") => {
    setChoosing(mode);
    setError(null);
    try {
      await setBillingMode(mode);
      await refreshUser();

      if (mode === "charon") {
        // Charon users get shade plan automatically → go to dashboard
        router.push("/overview");
      } else {
        // Achilles users → go to billing to pick a plan
        router.push("/billing");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setChoosing(null);
    }
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>
          Welcome to Styx
        </h1>
        <p className="mt-2 text-muted-foreground">
          Choose how you want to use the platform
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2" style={{ maxWidth: 720 }}>
        {/* ─── Charon (BYOK) ─────────────────────────── */}
        <Card className="relative overflow-hidden border-2 transition-colors hover:border-primary/50">
          <CardHeader>
            <div>
              <CardTitle className="text-lg">Charon</CardTitle>
              <CardDescription>Bring Your Own Keys</CardDescription>
            </div>
            <Badge variant="secondary" className="mt-2 w-fit">
              Free tier available
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Use your own API keys from OpenAI, Anthropic, Google, and Mistral.
              Pay providers directly — zero markup from us.
            </p>
            <ul className="mb-6 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>0% markup on API costs</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>10K free requests/month (Shade plan)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>Smart routing & fallback</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>Full control of your provider keys</span>
              </li>
            </ul>
            <Button
              className="w-full"
              onClick={() => handleChoice("charon")}
              disabled={choosing !== null}
            >
              {choosing === "charon" ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Setting up…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Choose Charon
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ─── Achilles (Managed) ────────────────────── */}
        <Card className="relative overflow-hidden border-2 transition-colors hover:border-primary/50">
          <div className="absolute right-0 top-0 rounded-bl-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            Popular
          </div>
          <CardHeader>
            <div>
              <CardTitle className="text-lg">Achilles</CardTitle>
              <CardDescription>Managed by Styx</CardDescription>
            </div>
            <Badge variant="secondary" className="mt-2 w-fit">
              Fastest setup
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              We handle the API keys. Buy prepaid credits and pay per token
              used. No provider accounts needed.
            </p>
            <ul className="mb-6 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>No API key management needed</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>Pay-as-you-go with prepaid credits</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>Access all AI models instantly</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 text-green-500" />
                <span>Smart routing, cache & fallback</span>
              </li>
            </ul>
            <Button
              className="w-full"
              variant="default"
              onClick={() => handleChoice("achilles")}
              disabled={choosing !== null}
            >
              {choosing === "achilles" ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Setting up…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Choose Achilles
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        This choice is permanent and cannot be changed later.
      </p>
    </div>
  );
}
