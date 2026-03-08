"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/api";
import type { User } from "@/lib/types";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

// Dev mode: fixed user that matches the backend's dev user
const DEV_USER: User = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "dev@styx.local",
  name: "Dev User",
  role: "admin",
  billing_mode: null,
  created_at: new Date().toISOString(),
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(SKIP_AUTH ? DEV_USER : null);
  const [loading, setLoading] = useState(!SKIP_AUTH);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Dev mode: no Supabase listeners needed
    if (SKIP_AUTH) return;

    let mounted = true;

    // Check Supabase session on mount
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: unknown } }) => {
      if (!mounted) return;
      if (session) {
        getMe()
          .then((u) => { if (mounted) setUser(u); })
          .catch(() => { if (mounted) setUser(null); })
          .finally(() => { if (mounted) setLoading(false); });
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, session: unknown) => {
        if (!mounted) return;
        if (event === "SIGNED_IN" && session) {
          try {
            const u = await getMe();
            if (mounted) setUser(u);
          } catch {
            if (mounted) setUser(null);
          }
        } else if (event === "SIGNED_OUT") {
          setUser(null);
        }
      }
    );

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [supabase]);

  const loginUser = useCallback(() => {
    getMe().then((u) => {
      setUser(u);
      router.push("/overview");
    });
  }, [router]);

  const logout = useCallback(async () => {
    if (!SKIP_AUTH) {
      await supabase.auth.signOut();
    }
    setUser(null);
    router.push("/login");
  }, [router, supabase]);

  const refreshUser = useCallback(async () => {
    if (SKIP_AUTH) return DEV_USER;
    try {
      const u = await getMe();
      setUser(u);
      return u;
    } catch {
      return null;
    }
  }, []);

  return { user, loading, loginUser, logout, refreshUser, isAuthenticated: !!user };
}
