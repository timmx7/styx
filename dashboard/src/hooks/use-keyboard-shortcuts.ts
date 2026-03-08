"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyboard shortcuts for the dashboard:
 * - Ctrl+K / Cmd+K  -> focus search (if exists) or navigate to overview
 * - g then a        -> go to analytics
 * - g then p        -> go to projects
 * - g then k        -> go to keys
 * - g then l        -> go to logs
 * - g then s        -> go to settings
 * - g then t        -> go to team
 * - g then b        -> go to billing
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingG = useCallback(() => {
    pendingG.current = false;
    if (gTimer.current) {
      clearTimeout(gTimer.current);
      gTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts when typing in inputs/textareas/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+K / Cmd+K -> focus search or go to overview
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          '[data-search-input], input[type="search"], input[placeholder*="Search"]'
        );
        if (searchInput) {
          searchInput.focus();
        } else {
          router.push("/overview");
        }
        clearPendingG();
        return;
      }

      // "g" prefix shortcuts (two-key combos)
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!pendingG.current) {
          pendingG.current = true;
          // Timeout: if second key is not pressed within 1s, cancel
          gTimer.current = setTimeout(() => {
            pendingG.current = false;
          }, 1000);
          return;
        }
      }

      if (pendingG.current) {
        clearPendingG();

        const routes: Record<string, string> = {
          a: "/analytics",
          p: "/projects",
          k: "/keys",
          l: "/logs",
          s: "/settings",
          t: "/team",
          b: "/billing",
          o: "/overview",
        };

        const route = routes[e.key];
        if (route) {
          e.preventDefault();
          router.push(route);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (gTimer.current) {
        clearTimeout(gTimer.current);
      }
    };
  }, [router, clearPendingG]);
}
