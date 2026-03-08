"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Dev mode: skip registration, go straight to dashboard
  useEffect(() => {
    if (SKIP_AUTH) router.replace("/overview");
  }, [router]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });
      if (error) {
        throw new Error(error.message);
      }
      toast.success("Account created! Check your email to confirm.");
      router.push("/login?message=check-email");
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
      className="min-h-screen flex items-center justify-center px-6 py-16"
      style={{ backgroundColor: "#f5f0eb" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        className="w-full max-w-md"
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
            Create your account
          </h1>
          <p className="mt-3 text-base" style={{ color: "#6b6560" }}>
            Start routing AI requests in minutes
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-0">
          {/* Name */}
          <div
            className="py-4"
            style={{ borderBottom: "1px solid #d6d0c8" }}
          >
            <label
              htmlFor="name"
              className="block text-xs font-medium uppercase tracking-widest mb-2"
              style={{ color: "#6b6560" }}
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full bg-transparent text-lg font-sans outline-none placeholder:text-[#d6d0c8]"
              style={{ color: "#1a1a1a" }}
            />
          </div>

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
              className="w-full bg-transparent text-lg font-sans outline-none placeholder:text-[#d6d0c8]"
              style={{ color: "#1a1a1a" }}
            />
          </div>

          {/* Password */}
          <div
            className="py-4 mb-8"
            style={{ borderBottom: "1px solid #d6d0c8" }}
          >
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-widest mb-2"
              style={{ color: "#6b6560" }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full bg-transparent text-lg font-sans outline-none placeholder:text-[#d6d0c8]"
              style={{ color: "#1a1a1a" }}
            />
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
                Create account
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Login link */}
        <p
          className="text-center mt-8 text-sm"
          style={{ color: "#6b6560" }}
        >
          Already have an account?{" "}
          <Link
            href="/login"
            className="hover:underline underline-offset-4"
            style={{ color: "#1400FF" }}
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
