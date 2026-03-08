"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Command, Menu } from "lucide-react";

/* Map pathname segment → display label */
const PAGE_LABELS: Record<string, string> = {
  overview: "Overview",
  projects: "Projects",
  keys: "API Keys",
  analytics: "Analytics",
  logs: "Logs",
  routing: "Routing",
  billing: "Billing",
  alerts: "Alerts",
  team: "Team",
  settings: "Settings",
  onboarding: "Onboarding",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useKeyboardShortcuts();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [pageReady, setPageReady] = useState(true);
  const prevPathRef = useRef(pathname);

  // Animate page transition on route change
  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      setPageReady(false);
      // Micro-delay then fade in — masks the content swap
      const id = requestAnimationFrame(() => setPageReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pathname]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/login");
    }
  }, [loading, isAuthenticated, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: "#f5f0eb" }}>
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "#1400FF", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!user) return null;

  /* Current page label from the first pathname segment */
  const segment = pathname.split("/").filter(Boolean)[0] ?? "overview";
  const pageLabel = PAGE_LABELS[segment] ?? segment;

  return (
    <div className="flex min-h-screen font-body selection:bg-[#1400FF]/10" style={{ backgroundColor: "#f5f0eb", color: "#1a1a1a" }}>

      <Sidebar
        userName={user.name}
        userEmail={user.email}
        onLogout={logout}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main area */}
      <div className="md:ml-[17rem] flex flex-1 flex-col relative z-10 min-h-screen">
        {/* ── Top header bar ── */}
        <header className="flex h-14 md:h-16 shrink-0 items-center justify-between px-4 md:px-10 border-b sticky top-0 z-20 backdrop-blur-md" style={{ borderColor: "#d6d0c8", backgroundColor: "rgba(245,240,235,0.9)" }}>
          <div className="flex items-center gap-3 md:gap-4">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg transition-colors"
              style={{ color: "#6b6560" }}
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-lg md:text-xl font-serif font-normal tracking-tight" style={{ color: "#1a1a1a" }}>{pageLabel}</h1>
            <div className="hidden md:block h-4 w-[1px]" style={{ backgroundColor: "#d6d0c8" }} />
            <div className="hidden md:flex items-center gap-2 text-xs rounded-full px-3 py-1.5" style={{ color: "#6b6560", backgroundColor: "rgba(0,0,0,0.03)", border: "1px solid #d6d0c8" }}>
              <Command className="w-3 h-3" />
              <span>K to search</span>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-4">
            {user.billing_mode && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: "rgba(20,0,255,0.04)", border: "1px solid rgba(20,0,255,0.15)" }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#1400FF" }} />
                <span className="text-sm font-medium capitalize" style={{ color: "#1400FF" }}>{user.billing_mode}</span>
              </div>
            )}
            <div className="h-8 w-8 md:h-10 md:w-10 shrink-0 rounded-full flex items-center justify-center text-sm md:text-base font-medium font-body uppercase text-white" style={{ backgroundColor: "#1400FF" }}>
              {(user.name || user.email || "U")[0]}
            </div>
          </div>
        </header>

        {/* Dev mode warning banner */}
        {process.env.NEXT_PUBLIC_SKIP_AUTH === "true" && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "#f59e0b" }}>
            <span>&#9888;&#65039;</span>
            <span>Dev Mode — Authentication is disabled. Do not use in production.</span>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-10">
          <div
            className="mx-auto max-w-6xl"
            style={{
              opacity: pageReady ? 1 : 0,
              transform: pageReady ? "translateY(0)" : "translateY(6px)",
              transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
            }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
