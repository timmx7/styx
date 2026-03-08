"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { StyxLogo } from "./StyxLogo";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const GITHUB_URL = "https://github.com/timmx7/styx";

const menuLinks = [
  { label: "Features", href: "#features", external: false },
  { label: "How it works", href: "#how-it-works", external: false },
  { label: "Docs", href: "/docs", external: false },
  { label: "GitHub ↗", href: GITHUB_URL, external: true },
  ...(SKIP_AUTH
    ? [{ label: "Dashboard", href: "/overview", external: false }]
    : [{ label: "Get started", href: "/docs/getting-started", external: false }]),
];

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[60] flex flex-col bg-background"
        >
          <div className="flex items-center justify-between px-6 h-20 border-b border-border">
            <StyxLogo size="sm" />
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close menu"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <nav className="flex-1 flex flex-col items-center justify-center gap-8">
            {menuLinks.map((link, i) => (
              <motion.div
                key={link.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07, duration: 0.4 }}
              >
                {link.external ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onClose}
                    className="text-2xl font-body text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    href={link.href}
                    onClick={onClose}
                    className="text-2xl font-body text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                )}
              </motion.div>
            ))}
          </nav>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: menuLinks.length * 0.07, duration: 0.4 }}
            className="flex justify-center pb-12"
          >
            <Link
              href={SKIP_AUTH ? "/overview" : "/docs/getting-started"}
              onClick={onClose}
              className="bg-primary text-white rounded-full px-8 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {SKIP_AUTH ? "Open Dashboard" : "Get started free"}
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
