"use client";

import { Navigation } from "@/components/landing/Navigation";
import { Hero } from "@/components/landing/Hero";
import { ProviderMarquee } from "@/components/landing/ProviderMarquee";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Features } from "@/components/landing/Features";
import { Comparison } from "@/components/landing/Comparison";
import { OpenSource } from "@/components/landing/OpenSource";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-background font-body">
      <Navigation />
      <Hero />
      <ProviderMarquee />
      <HowItWorks />
      <Features />
      <Comparison />
      <OpenSource />
      <FinalCTA />
      <Footer />
    </div>
  );
}
