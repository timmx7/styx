"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Mail, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = createClient();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/auth/callback`,
      });
      if (error) {
        throw new Error(error.message);
      }
      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F7F5] font-sans relative overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Background gradient - similar to hero */}
      <div className="absolute top-0 left-0 right-0 h-96 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-50/60 via-stone-50/50 via-30% via-slate-50/40 via-60% to-neutral-50/50"></div>
        <div className="absolute inset-0 bg-gradient-to-tr from-beige-50/30 via-transparent to-gray-50/30"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-0% via-[#F7F7F5]/60 via-70% to-[#F7F7F5] to-100%"></div>
      </div>

      {/* Animated background blobs */}
      <motion.div
        className="absolute top-20 right-20 w-[400px] h-[400px] bg-gradient-to-br from-amber-100/20 via-stone-100/15 to-neutral-100/10 rounded-full blur-3xl"
        animate={{
          x: [0, 30, 0],
          y: [0, -30, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute bottom-20 left-20 w-[350px] h-[350px] bg-gradient-to-br from-slate-100/15 via-gray-100/10 to-stone-100/15 rounded-full blur-3xl"
        animate={{
          x: [0, -20, 0],
          y: [0, 20, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Logo - top left */}
      <div className="absolute top-8 left-8 z-50">
        <Link href="/" className="group flex items-center gap-2">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-[#1A1A1B] to-[#3A3A3B] blur-lg opacity-40 group-hover:opacity-60 transition-opacity"></div>
            <div className="relative font-serif text-2xl text-[#1A1A1B] group-hover:text-[#2A2A2B] transition-colors" style={{ fontWeight: '400', letterSpacing: '-0.02em' }}>
              Styx
            </div>
          </div>
        </Link>
      </div>

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          {/* Glass card */}
          <div className="relative bg-white/30 backdrop-blur-2xl rounded-3xl p-10 border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Multiple glass effect layers */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-white/20 to-white/10 pointer-events-none"></div>
            <div className="absolute inset-0 bg-gradient-to-tl from-transparent via-white/10 to-transparent pointer-events-none"></div>
            <div className="absolute inset-0 rounded-3xl shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.9)] pointer-events-none"></div>

            {/* Content */}
            <div className="relative z-10">
              {submitted ? (
                /* Success state */
                <div className="text-center">
                  <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100/50">
                    <Mail className="h-8 w-8 text-green-600" />
                  </div>
                  <h1 className="font-serif text-[#1A1A1B] text-3xl mb-3" style={{ fontWeight: '300', letterSpacing: '-0.02em' }}>
                    Check your email
                  </h1>
                  <p className="text-[#1A1A1B]/60 mb-8">
                    If an account exists with that email, you&apos;ll receive a reset link.
                  </p>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 text-[#1A1A1B] font-medium hover:text-[#1A1A1B]/70 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to sign in
                  </Link>
                </div>
              ) : (
                /* Form state */
                <>
                  <div className="text-center mb-8">
                    <h1 className="font-serif text-[#1A1A1B] text-4xl mb-3" style={{ fontWeight: '300', letterSpacing: '-0.02em' }}>
                      Reset password
                    </h1>
                    <p className="text-[#1A1A1B]/60">
                      Enter your email and we&apos;ll send you a reset link
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="email" className="block text-[#1A1A1B]/70 text-sm mb-2 ml-1">
                        Email
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#1A1A1B]/40" />
                        <input
                          type="email"
                          id="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full bg-white/40 backdrop-blur-sm border border-white/30 rounded-2xl py-3 pl-12 pr-4 text-[#1A1A1B] placeholder:text-[#1A1A1B]/30 focus:outline-none focus:ring-2 focus:ring-[#1A1A1B]/20 focus:border-white/50 transition-all"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-[#1A1A1B] hover:bg-[#2A2A2B] text-[#F7F7F5] rounded-2xl py-3.5 px-6 font-medium flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#1A1A1B]/20 hover:shadow-xl hover:shadow-[#1A1A1B]/30 mt-6 disabled:opacity-50"
                    >
                      {loading ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#F7F7F5] border-t-transparent" />
                          Sending...
                        </span>
                      ) : (
                        <>
                          Send reset link
                          <ArrowRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  </form>

                  <div className="text-center mt-6">
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-2 text-[#1A1A1B]/60 hover:text-[#1A1A1B] transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to sign in
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
