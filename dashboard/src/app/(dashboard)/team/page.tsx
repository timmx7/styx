"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import {
  Users,
  Crown,
  Shield,
  UserCircle,
  Mail,
  Calendar,
  Pencil,
  Check,
  X,
  UserPlus,
  AlertTriangle,
  LogOut,
  Trash2,
  Code,
  CreditCard,
  Eye,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTeam, getMe, updateTeam, inviteTeamMember, getTeamMembers, leaveTeam, deleteTeam, getTeamSSOConfig, updateTeamSSOConfig } from "@/lib/api";
import type { Team, TeamMember, User, IdentityProvider } from "@/lib/types";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { WebhooksTab } from "@/components/team/WebhooksTab";


const roleBadge = (role: string) => {
  switch (role) {
    case "owner":
      return (
        <Badge className="gap-1 hover:opacity-80" style={{ backgroundColor: "rgba(20,0,255,0.08)", color: "#1400FF" }}>
          <Crown className="h-3 w-3" />
          Owner
        </Badge>
      );
    case "admin":
      return (
        <Badge className="gap-1 bg-blue-500/10 text-blue-600 hover:bg-blue-500/15">
          <Shield className="h-3 w-3" />
          Admin
        </Badge>
      );
    case "developer":
      return (
        <Badge variant="secondary" className="gap-1 text-muted-foreground">
          <Code className="h-3 w-3" />
          Developer
        </Badge>
      );
    case "billing":
      return (
        <Badge className="gap-1 bg-orange-500/10 text-orange-600 hover:bg-orange-500/15">
          <CreditCard className="h-3 w-3" />
          Billing
        </Badge>
      );
    case "viewer":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Eye className="h-3 w-3" />
          Viewer
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1 text-muted-foreground">
          <UserCircle className="h-3 w-3" />
          Member
        </Badge>
      );
  }
};

export default function TeamPage() {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [leavingTeam, setLeavingTeam] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);

  // Team name editing
  const [editingName, setEditingName] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Confirmation dialogs
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // SSO Configuration
  const [ssoConfig, setSsoConfig] = useState<IdentityProvider | null>(null);
  const [ssoDomain, setSsoDomain] = useState("");
  const [ssoUrl, setSsoUrl] = useState("");
  const [ssoActive, setSsoActive] = useState(true);
  const [savingSso, setSavingSso] = useState(false);

  useEffect(() => {
    Promise.all([getTeam(), getMe()])
      .then(async ([t, u]) => {
        setTeam(t ?? null);
        setUser(u);
        setTeamName(t?.name || "");
        // Fetch actual team members if a team exists
        if (t?.id) {
          try {
            const ssoPromise = getTeamSSOConfig(t.id).catch(() => null);
            const teamMembers = await getTeamMembers(t.id);
            setMembers(teamMembers);
            const sso = await ssoPromise;
            setSsoConfig(sso);
            if (sso) {
              setSsoDomain(sso.domain);
              setSsoUrl((sso.config?.single_sign_on_service_url as string) || "");
              setSsoActive(sso.is_active);
            }
          } catch (err) {
            // If fetching members fails, fall back to showing current user only
            Sentry.captureException(err || new Error("Failed to fetch team members"));
          }
        }
      })
      .catch(() => toast.error("Failed to load team data"))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveName = async () => {
    if (!team || !teamName.trim()) return;
    setSavingName(true);
    try {
      const updated = await updateTeam(team.id, { name: teamName.trim() });
      setTeam(updated);
      setEditingName(false);
      toast.success("Team name updated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update team name"
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteSuccess(null);
    try {
      const result = await inviteTeamMember(team.id, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      toast.success(result.message || "Invitation sent successfully");
      setInviteSuccess(inviteEmail.trim());
      setInviteEmail("");
      setInviteRole("developer");
      setTimeout(() => setInviteSuccess(null), 5000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send invitation"
      );
    } finally {
      setInviting(false);
    }
  };

  const handleSaveSso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team || !ssoDomain.trim()) return;
    // Validate SSO URL is HTTPS
    if (ssoUrl.trim()) {
      try {
        const url = new URL(ssoUrl.trim());
        if (url.protocol !== 'https:') {
          toast.error("SSO URL must use HTTPS");
          return;
        }
      } catch {
        toast.error("Invalid SSO URL format");
        return;
      }
    }
    setSavingSso(true);
    try {
      const updated = await updateTeamSSOConfig(team.id, {
        domain: ssoDomain.trim(),
        provider_type: "saml",
        is_active: ssoActive,
        config: { single_sign_on_service_url: ssoUrl.trim() }
      });
      setSsoConfig(updated);
      toast.success("SSO configuration saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save SSO config");
    } finally {
      setSavingSso(false);
    }
  };

  const currentUserMember = members.find((m) => m.user_id === user?.id);
  const isOwner = user?.id === team?.owner_id;
  const canManageSSO = isOwner || currentUserMember?.role === "admin";

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!team || !user) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Team</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your team members and settings.
          </p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-xl bg-secondary p-4">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No team yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project first to set up your team.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const planDisplay: Record<string, string> = {
    free: "Free",
    starter: "Starter",
    pro: "Pro",
    enterprise: "Enterprise",
  };

  return (
    <div className="space-y-8">
      <Breadcrumbs />
      {/* Header */}
      <div>
        <h1 className="font-serif text-3xl tracking-tight" style={{ fontWeight: 400 }}>Team</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your team members and settings.
        </p>
      </div>

      {/* Team Info Card */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Team Information</CardTitle>
          <CardDescription>
            Your team details and current plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            {/* Team Name */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Team Name
              </p>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-emerald-600 hover:text-emerald-500"
                    onClick={handleSaveName}
                    disabled={savingName}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingName(false);
                      setTeamName(team.name);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{team.name}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingName(true)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {/* Plan */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Current Plan
              </p>
              <div>
                <Badge className="bg-foreground/5 text-foreground hover:bg-foreground/10">
                  {planDisplay[team.plan] || team.plan}
                </Badge>
              </div>
            </div>

            {/* Created */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Created
              </p>
              <div className="flex items-center gap-1.5 text-sm">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(team.created_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="members">Members</TabsTrigger>
          {canManageSSO && <TabsTrigger value="sso">SSO Configuration</TabsTrigger>}
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-8">
          {/* Members List */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                People who have access to this team&apos;s projects and resources.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.length > 0 ? (
                    members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase text-muted-foreground">
                              {(member.user_name || member.user_email || "?")[0]}
                            </div>
                            {member.user_name || member.user_email?.split("@")[0] || "Unknown"}
                            {member.user_id === user.id && (
                              <span className="text-xs text-muted-foreground">(you)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {member.user_email}
                        </TableCell>
                        <TableCell>{roleBadge(member.role)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(member.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {/* No actions for now */}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase text-muted-foreground">
                            {(user.name || user.email || "?")[0]}
                          </div>
                          {user.name || "You"}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>{roleBadge("owner")}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {/* No actions for owner */}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Invite Members */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite Members
              </CardTitle>
              <CardDescription>
                Add team members by email. They&apos;ll receive an invitation to
                join your team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="inviteEmail">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="inviteEmail"
                        type="email"
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div className="w-full space-y-2 sm:w-40">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="developer">Developer</SelectItem>
                        <SelectItem value="billing">Billing</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="member">Member (Legacy)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="submit"
                      className="w-full gap-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
                      disabled={!inviteEmail.trim() || inviting}
                    >
                      {inviting ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" />
                          Send Invite
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {inviteSuccess && (
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                    <p className="text-xs text-green-600">
                      Invitation sent to <strong>{inviteSuccess}</strong>. They will
                      receive an email with instructions to join your team.
                    </p>
                  </div>
                )}

                <div className="rounded-lg border border-border bg-secondary/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    Team members will be able to manage projects, view analytics,
                    and use shared API keys based on their assigned role.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {canManageSSO && (
          <TabsContent value="sso" className="space-y-8">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  SSO Configuration (SAML)
                </CardTitle>
                <CardDescription>
                  Configure Single Sign-On for your enterprise. When users log in with an email matching this domain,
                  they will be redirected to your Identity Provider.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveSso} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ssoDomain">Email Domain</Label>
                      <Input
                        id="ssoDomain"
                        placeholder="acme.com"
                        value={ssoDomain}
                        onChange={(e) => setSsoDomain(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">The email domain for your organization.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ssoUrl">SAML SSO URL</Label>
                      <Input
                        id="ssoUrl"
                        placeholder="https://idp.example.com/sso/saml"
                        value={ssoUrl}
                        onChange={(e) => setSsoUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Your IdP&apos;s Single Sign-On Service URL.</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="ssoActive"
                      checked={ssoActive}
                      onChange={(e) => setSsoActive(e.target.checked)}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <Label htmlFor="ssoActive" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      Enable SSO for this domain
                    </Label>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={savingSso || !ssoDomain.trim()}>
                      {savingSso ? "Saving..." : ssoConfig ? "Update Configuration" : "Save Configuration"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="webhooks" className="space-y-8">
          <WebhooksTab teamId={team.id} />
        </TabsContent>
      </Tabs>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Irreversible actions that affect your team. Proceed with caution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Leave Team */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Leave Team</p>
              <p className="text-xs text-muted-foreground">
                Remove yourself from this team. You will lose access to all
                projects and resources.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={() => setLeaveDialogOpen(true)}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Leave
            </Button>
          </div>

          <Separator />

          {/* Delete Team */}
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-destructive">
                Delete Team
              </p>
              <p className="text-xs text-muted-foreground">
                Permanently delete this team, all projects, API keys, and data.
                This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leave Team Dialog */}
      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave &ldquo;{team.name}&rdquo;? You
              will lose access to all projects and API keys.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLeaveDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={leavingTeam}
              onClick={async () => {
                setLeavingTeam(true);
                try {
                  await leaveTeam(team.id);
                  toast.success("You have left the team.");
                  setLeaveDialogOpen(false);
                  router.push("/overview");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to leave team");
                } finally {
                  setLeavingTeam(false);
                }
              }}
            >
              {leavingTeam ? "Leaving..." : "Leave Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Team Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All projects, API
              keys, usage data, and billing information will be permanently
              deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              Warning: This will immediately revoke all API keys and stop all
              traffic routing through Styx.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingTeam}
              onClick={async () => {
                setDeletingTeam(true);
                try {
                  await deleteTeam(team.id);
                  toast.success("Team deleted permanently.");
                  setDeleteDialogOpen(false);
                  router.push("/overview");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Failed to delete team");
                } finally {
                  setDeletingTeam(false);
                }
              }}
            >
              {deletingTeam ? "Deleting..." : "Delete Team Forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
