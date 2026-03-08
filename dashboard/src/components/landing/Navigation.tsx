"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { StyxLogo } from "./StyxLogo";
import { MobileMenu } from "./MobileMenu";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const GITHUB_URL = "https://github.com/timmx7/styx";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: GITHUB_URL, external: true },
];

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Outer div owns all positioning — framer-motion inline transforms would override Tailwind's -translate-x-1/2 */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-48px)] max-w-[1100px]">
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center justify-between h-14 px-6 backdrop-blur-xl bg-background/85 border border-border rounded-full shadow-sm">
          <Link href="/">
            <StyxLogo size="sm" />
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-7">
            {navLinks.map((link) =>
              "external" in link && link.external ? (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-body text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label} ↗
                </a>
              ) : (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-[13px] font-body text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              )
            )}

            <Link
              href={SKIP_AUTH ? "/overview" : "/login"}
              className="rounded-full px-5 py-2 text-[13px] font-medium font-body bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              {SKIP_AUTH ? "Dashboard →" : "Get started"}
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </motion.nav>
      </div>

      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  );
}
