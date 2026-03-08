"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Bell,
  CreditCard,
  Cpu,
  LayoutDashboard,
  FolderKanban,
  KeyRound,
  LogOut,
  Network,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  userName: string | null;
  userEmail: string;
  onLogout: () => void;
  /** Mobile: whether the sidebar overlay is open */
  mobileOpen?: boolean;
  /** Mobile: called when the sidebar should close */
  onMobileClose?: () => void;
}

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/prompts", label: "Playground", icon: Sparkles },
  { href: "/keys", label: "API Keys", icon: KeyRound },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/analytics/users", label: "End-Users", icon: Users },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/routing", label: "Routing", icon: Network },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

function SidebarContent({
  userName,
  userEmail,
  onLogout,
  onNavClick,
}: {
  userName: string | null;
  userEmail: string;
  onLogout: () => void;
  onNavClick?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b" style={{ borderColor: "#d6d0c8" }}>
        <Link href="/" className="font-serif text-xl" style={{ color: "#1a1a1a" }}>
          styx.
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto space-y-0.5 px-3 py-5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-sans transition-all duration-200",
                isActive
                  ? "font-medium"
                  : "hover:bg-black/[0.03]"
              )}
              style={isActive ? { backgroundColor: "rgba(20,0,255,0.06)", color: "#1400FF" } : { color: "#6b6560" }}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
                  style={{ backgroundColor: "#1400FF" }}
                />
              )}
              <item.icon
                className="h-4 w-4 transition-colors duration-200"
                style={isActive ? { color: "#1400FF" } : { color: "#9b9590" }}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-3 mx-3 mb-3 rounded-xl" style={{ backgroundColor: "rgba(0,0,0,0.03)", border: "1px solid #d6d0c8" }}>
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body font-medium uppercase text-white text-sm" style={{ backgroundColor: "#1400FF" }}>
            {(userName || userEmail || "U")[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" style={{ color: "#1a1a1a" }}>
              {userName || "User"}
            </p>
            <p className="truncate text-xs" style={{ color: "#6b6560" }}>
              {userEmail}
            </p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="group flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
          style={{ backgroundColor: "rgba(0,0,0,0.04)", border: "1px solid #d6d0c8", color: "#6b6560" }}
        >
          <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
          Log out
        </button>
      </div>
    </>
  );
}

export function Sidebar({
  userName,
  userEmail,
  onLogout,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  return (
    <>
      {/* ── Desktop sidebar (hidden below md) ── */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-[16.5rem] flex-col overflow-hidden" style={{ backgroundColor: "#f5f0eb", borderRight: "1px solid #d6d0c8" }}>
        <SidebarContent
          userName={userName}
          userEmail={userEmail}
          onLogout={onLogout}
        />
      </aside>

      {/* ── Mobile sidebar overlay (visible below md when open) ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
              onClick={onMobileClose}
            />
            {/* Slide-in panel */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-72 flex flex-col shadow-xl overflow-hidden"
              style={{ backgroundColor: "#f5f0eb", borderRight: "1px solid #d6d0c8" }}
            >
              {/* Close button */}
              <button
                onClick={onMobileClose}
                className="absolute top-4 right-3 z-10 p-2 rounded-lg transition-colors hover:bg-black/[0.03]"
                style={{ color: "#6b6560" }}
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>

              <SidebarContent
                userName={userName}
                userEmail={userEmail}
                onLogout={onLogout}
                onNavClick={onMobileClose}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
