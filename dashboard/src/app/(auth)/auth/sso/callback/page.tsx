"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy SSO callback page.
 * Supabase handles OAuth callbacks directly. This page now simply
 * redirects to the overview dashboard.
 */
export default function SSOCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/overview");
  }, [router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#f5f0eb" }}
    >
      <div className="w-6 h-6 border-2 border-[#d6d0c8] border-t-[#1a1a1a] rounded-full animate-spin" />
    </div>
  );
}
