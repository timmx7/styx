"use client";

import { useState, useEffect, Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const LoginScene = dynamic(() => import("@/components/auth/LoginScene"), { ssr: false });

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Dev mode: skip login, go straight to dashboard
  useEffect(() => {
    if (SKIP_AUTH) router.replace("/overview");
  }, [router]);
  const rawReturnTo = searchParams.get("returnTo") || "/overview";
  const returnTo = /^\/(?!\/)/.test(rawReturnTo) ? rawReturnTo : "/overview";
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        throw new Error(error.message);
      }
      toast.success("Welcome back!");
      router.push(returnTo);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center px-6 py-16 overflow-hidden"
      style={{ backgroundColor: "#f5f0eb" }}
    >
      <LoginScene />
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <Link href="/" className="block mb-16 text-center">
          <span
            className="font-serif text-2xl tracking-tight"
            style={{ color: "#1a1a1a" }}
          >
            styx.
          </span>
        </Link>

        {/* Heading */}
        <div className="text-center mb-12">
          <h1
            className="font-serif text-4xl font-normal tracking-tight"
            style={{ color: "#1a1a1a" }}
          >
            Welcome back
          </h1>
          <p className="mt-3 text-base" style={{ color: "#6b6560" }}>
            Sign in to your account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-0">
          {/* Email */}
          <div
            className="py-4"
            style={{ borderBottom: "1px solid #d6d0c8" }}
          >
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-widest mb-2"
              style={{ color: "#6b6560" }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full bg-transparent text-lg font-sans outline-none placeholder:text-[#d6d0c8] focus:ring-0 focus:outline-none"
              style={{ color: "#1a1a1a", WebkitAppearance: "none" }}
            />
          </div>

          {/* Password */}
          <div
            className="py-4"
            style={{ borderBottom: "1px solid #d6d0c8" }}
          >
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-widest mb-2"
              style={{ color: "#6b6560" }}
            >
              Password
            </label>
            <div className="flex items-center gap-2">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="flex-1 bg-transparent text-lg font-sans outline-none placeholder:text-[#d6d0c8] focus:ring-0 focus:outline-none"
                style={{ color: "#1a1a1a" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="p-1.5 rounded-md transition-colors hover:bg-black/[0.04]"
                style={{ color: "#6b6560" }}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Forgot password */}
          <div className="flex items-center justify-between pt-4 pb-8">
            <Link
              href="/forgot-password"
              className="text-sm hover:underline underline-offset-4"
              style={{ color: "#6b6560" }}
            >
              Forgot password?
            </Link>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-full px-8 py-4 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#1400FF" }}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Register link */}
        <p
          className="text-center mt-8 text-sm"
          style={{ color: "#6b6560" }}
        >
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="hover:underline underline-offset-4"
            style={{ color: "#1400FF" }}
          >
            Create one
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: "#f5f0eb" }}
        >
          <div className="w-6 h-6 border-2 border-[#d6d0c8] border-t-[#1a1a1a] rounded-full animate-spin" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
