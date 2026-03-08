"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  CheckCheck,
  Eye,
  EyeOff,
  ArrowRight,
  Zap,
  Rocket,
  KeyRound,
  Code2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeam, createProject, createApiKey } from "@/lib/api";
import type { Project, ApiKeyCreated } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

const stepMeta = [
  { label: "Welcome", icon: Rocket },
  { label: "Project", icon: Zap },
  { label: "API Key", icon: KeyRound },
  { label: "First Call", icon: Code2 },
];

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [apiKey, setApiKey] = useState<ApiKeyCreated | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [projectCreated, setProjectCreated] = useState(false);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      toast.error("Enter a project name");
      return;
    }
    setCreating(true);
    try {
      const team = await createTeam(`${projectName.trim()} Team`);
      const proj = await createProject({
        name: projectName.trim(),
        team_id: team.id,
      });
      setProject(proj);
      setProjectCreated(true);
      toast.success("Project created!");
      // Brief delay for the checkmark animation, then advance
      setTimeout(() => setStep(3), 1200);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create project"
      );
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateKey = async () => {
    if (!project) return;
    setGeneratingKey(true);
    try {
      const key = await createApiKey({
        project_id: project.id,
        name: "default",
      });
      setApiKey(key);
      toast.success("API key generated!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate key"
      );
    } finally {
      setGeneratingKey(false);
    }
  };

  const pythonExample = `from openai import OpenAI

client = OpenAI(
    api_key="${apiKey?.key || "sk_styx_YOUR_KEY_HERE"}",
    base_url="https://api.styx.ai/v1"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`;

  const curlExample = `curl https://api.styx.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey?.key || "sk_styx_YOUR_KEY_HERE"}" \\
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative mx-4 w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl">
        {/* Close button */}
        <button
          onClick={onComplete}
          className="absolute right-4 top-4 rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Progress bar */}
        <div className="border-b border-border px-8 pb-4 pt-8">
          <div className="flex items-center justify-between">
            {stepMeta.map((s, i) => {
              const stepNum = (i + 1) as Step;
              const isActive = step === stepNum;
              const isCompleted = step > stepNum;
              return (
                <div key={s.label} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all",
                      isCompleted
                        ? "bg-emerald-500/10 text-emerald-600"
                        : isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      stepNum
                    )}
                  </div>
                  <span
                    className={cn(
                      "hidden text-sm font-medium sm:inline",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {s.label}
                  </span>
                  {i < stepMeta.length - 1 && (
                    <div
                      className={cn(
                        "mx-2 hidden h-px w-8 sm:block md:w-12",
                        isCompleted ? "bg-emerald-500/40" : "bg-border"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="px-8 py-8">
          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground/5">
                <Zap className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                Welcome to Styx!
              </h2>
              <p className="mx-auto mt-3 max-w-md text-muted-foreground">
                Let&apos;s get you set up in 60 seconds. Styx is your
                intelligent AI gateway &mdash; one API endpoint to access all AI
                providers, with smart routing, caching, and cost optimization
                built in.
              </p>
              <div className="mx-auto mt-6 grid max-w-sm gap-3 text-left">
                {[
                  "Access OpenAI, Anthropic, Google, and Mistral from one endpoint",
                  "Reduce costs by up to 40% with smart routing",
                  "Zero-downtime with automatic provider fallback",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="text-sm text-muted-foreground">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
              <Button
                className="mt-8 gap-2 bg-primary px-8 font-semibold text-primary-foreground hover:bg-primary/90"
                onClick={() => setStep(2)}
              >
                Let&apos;s Go
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Step 2: Create Project */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                Create Your First Project
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A project groups your API keys, budgets, and routing rules
                together.
              </p>

              {projectCreated ? (
                <div className="mt-8 flex flex-col items-center py-8">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 animate-in zoom-in-50 duration-300" />
                  </div>
                  <p className="mt-4 text-lg font-semibold">
                    Project &ldquo;{project?.name}&rdquo; created!
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Moving to the next step...
                  </p>
                </div>
              ) : (
                <form onSubmit={handleCreateProject} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="projectName">Project Name</Label>
                    <Input
                      id="projectName"
                      placeholder="My AI App, Production, Chatbot..."
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      You can rename it later. Pick anything descriptive.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    disabled={creating || !projectName.trim()}
                  >
                    {creating ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Project
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              )}
            </div>
          )}

          {/* Step 3: Generate API Key */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                Generate Your API Key
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You&apos;ll use this key to authenticate with the Styx
                gateway.
              </p>

              {apiKey ? (
                <div className="mt-6 space-y-4">
                  {/* Key display */}
                  <div className="rounded-lg border border-border bg-secondary p-4">
                    <div className="flex items-center justify-between gap-2">
                      <code className="flex-1 break-all text-sm">
                        {showKey
                          ? apiKey.key
                          : apiKey.key.slice(0, 12) +
                            "..." +
                            "*".repeat(40)}
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
                          onClick={() => copyText(apiKey.key, "key")}
                        >
                          {copied === "key" ? (
                            <CheckCheck className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Warning */}
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs font-medium text-amber-600">
                      Save this key! You won&apos;t see it again. Store it
                      somewhere secure.
                    </p>
                  </div>

                  <Button
                    className="w-full gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                    onClick={() => setStep(4)}
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="mt-8 flex flex-col items-center py-4">
                  <div className="rounded-xl bg-secondary p-4">
                    <KeyRound className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">
                    One click and your key is ready.
                  </p>
                  <Button
                    className="mt-4 gap-2 bg-primary px-8 font-semibold text-primary-foreground hover:bg-primary/90"
                    onClick={handleGenerateKey}
                    disabled={generatingKey}
                  >
                    {generatingKey ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" />
                        Generate API Key
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 4: First API Call */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-bold tracking-tight">
                Make Your First API Call
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Just change your base URL &mdash; everything else stays the
                same.
              </p>

              <div className="mt-6 space-y-4">
                {/* Python example */}
                <div>
                  <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-secondary px-4 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Python
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => copyText(pythonExample, "python")}
                    >
                      {copied === "python" ? (
                        <>
                          <CheckCheck className="h-3 w-3 text-green-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-b-lg border border-border bg-secondary/50 p-4 text-xs leading-relaxed">
                    <code>{pythonExample}</code>
                  </pre>
                </div>

                {/* Curl example */}
                <div>
                  <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-secondary px-4 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      cURL
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => copyText(curlExample, "curl")}
                    >
                      {copied === "curl" ? (
                        <>
                          <CheckCheck className="h-3 w-3 text-green-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="overflow-x-auto rounded-b-lg border border-border bg-secondary/50 p-4 text-xs leading-relaxed">
                    <code>{curlExample}</code>
                  </pre>
                </div>

                <Button
                  className="w-full gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
                  onClick={onComplete}
                >
                  <Rocket className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
