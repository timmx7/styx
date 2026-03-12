"use client";

import { useEffect, useState } from "react";
import { Save, User, Bell, Shield, Eye, EyeOff, Copy, Check, Server } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { API_BASE } from "@/lib/api";

export default function SettingsPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [notifications] = useState({
    budgetAlerts: true,
    weeklyReports: false,
    downtime: true,
  });
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [copiedInstanceId, setCopiedInstanceId] = useState(false);

  // Notification preferences — UI preview (backend integration pending)

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmail(user.email);
    }
  }, [user]);

  useEffect(() => {
    fetch(`${API_BASE}/api/instance`)
      .then((r) => r.json())
      .then((data: { instance_id?: string }) => setInstanceId(data.instance_id ?? null))
      .catch(() => setInstanceId(null));
  }, []);

  const handleCopyInstanceId = () => {
    if (!instanceId) return;
    navigator.clipboard.writeText(instanceId).then(() => {
      setCopiedInstanceId(true);
      setTimeout(() => setCopiedInstanceId(false), 2000);
    });
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileSuccess(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        email: email !== user?.email ? email : undefined,
        data: { name },
      });
      if (error) throw new Error(error.message);
      toast.success("Profile updated successfully");
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSavingPassword(true);
    setPasswordSuccess(false);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw new Error(error.message);
      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <>
      <Breadcrumbs />
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Settings</h1>
          <p className="text-muted-foreground">
            Manage your account settings and preferences.
          </p>
        </div>

        {/* Profile section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>
              Your personal information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  type="email"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveProfile} disabled={savingProfile} size="sm">
                <Save className="mr-2 h-4 w-4" />
                {savingProfile ? "Saving..." : "Save Changes"}
              </Button>
              {profileSuccess && (
                <span className="text-sm text-green-600">Saved successfully</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Password section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Password</CardTitle>
            </div>
            <CardDescription>
              Change your password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-md space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleChangePassword} disabled={savingPassword} size="sm">
                <Shield className="mr-2 h-4 w-4" />
                {savingPassword ? "Changing..." : "Change Password"}
              </Button>
              {passwordSuccess && (
                <span className="text-sm text-green-600">Password changed</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Instance ID section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <CardTitle>Instance</CardTitle>
            </div>
            <CardDescription>
              Unique identifier for this Styx deployment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Label>Instance ID</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={instanceId ?? "Loading…"}
                  className="font-mono text-sm text-muted-foreground bg-muted/50 cursor-default"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyInstanceId}
                  disabled={!instanceId}
                  className="shrink-0"
                >
                  {copiedInstanceId ? (
                    <><Check className="h-4 w-4 text-green-600" /><span className="ml-1.5 text-green-600">Copied</span></>
                  ) : (
                    <><Copy className="h-4 w-4" /><span className="ml-1.5">Copy</span></>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Generated by <code className="text-[11px] bg-muted px-1 py-0.5 rounded">setup.sh</code> and stored in your <code className="text-[11px] bg-muted px-1 py-0.5 rounded">.env</code> as <code className="text-[11px] bg-muted px-1 py-0.5 rounded">INSTANCE_ID</code>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Notification preferences */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              <CardTitle>Notifications</CardTitle>
            </div>
            <CardDescription>
              Configure how you receive alerts and notifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Budget Alerts</p>
                  <p className="text-xs text-muted-foreground">
                    Receive email notifications when budget thresholds are reached.
                  </p>
                </div>
                <input type="checkbox" checked={notifications.budgetAlerts} readOnly className="h-4 w-4 rounded border-border" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Provider Outage Alerts</p>
                  <p className="text-xs text-muted-foreground">
                    Get notified when a provider goes down or recovers.
                  </p>
                </div>
                <input type="checkbox" checked={notifications.downtime} readOnly className="h-4 w-4 rounded border-border" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Weekly Report</p>
                  <p className="text-xs text-muted-foreground">
                    Receive a weekly summary of your API usage and costs.
                  </p>
                </div>
                <input type="checkbox" checked={notifications.weeklyReports} readOnly className="h-4 w-4 rounded border-border" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
