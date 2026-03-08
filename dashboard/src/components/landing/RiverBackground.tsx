"use client";

import { motion } from "framer-motion";

export function RiverBackground() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        backgroundColor: "#030303",
      }}
      aria-hidden="true"
    >
      {/* 
        High-visibility Stripe-style flowing mesh gradient.
        We use much higher opacity, larger scale, tighter blurs, 
        and overlapping colors to create a vivid "liquid" river.
      */}

      {/* Deep Purple Core */}
      <motion.div
        animate={{
          x: ["-30%", "20%", "-30%"],
          y: ["-10%", "10%", "-10%"],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        style={{
          position: "absolute",
          top: "10%",
          left: "-10%",
          width: "80vw",
          height: "80vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(124, 58, 237, 0.8) 0%, transparent 60%)",
          filter: "blur(90px)",
          transformOrigin: "center center",
          mixBlendMode: "screen",
        }}
      />

      {/* Bright Cyan Flow */}
      <motion.div
        animate={{
          x: ["20%", "-20%", "20%"],
          y: ["10%", "-5%", "10%"],
          scale: [1.1, 0.9, 1.1],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "absolute",
          top: "20%",
          right: "-10%",
          width: "70vw",
          height: "90vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(6, 182, 212, 0.8) 0%, transparent 60%)",
          filter: "blur(100px)",
          transformOrigin: "center center",
          mixBlendMode: "screen",
        }}
      />

      {/* Radiant Pink/Magenta Highlight (Stripe aesthetic) */}
      <motion.div
        animate={{
          x: ["-10%", "30%", "-10%"],
          y: ["20%", "-20%", "20%"],
          scale: [0.9, 1.3, 0.9],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2
        }}
        style={{
          position: "absolute",
          bottom: "-10%",
          left: "20%",
          width: "60vw",
          height: "70vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(219, 39, 119, 0.7) 0%, transparent 60%)",
          filter: "blur(80px)",
          transformOrigin: "center center",
          mixBlendMode: "screen",
        }}
      />

      {/* Emerald Accent */}
      <motion.div
        animate={{
          x: ["10%", "-30%", "10%"],
          y: ["-20%", "20%", "-20%"],
          scale: [1, 1.4, 1],
        }}
        transition={{
          duration: 28,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        style={{
          position: "absolute",
          top: "40%",
          right: "20%",
          width: "50vw",
          height: "60vh",
          borderRadius: "50%",
          background: "radial-gradient(ellipse at center, rgba(16, 185, 129, 0.6) 0%, transparent 60%)",
          filter: "blur(90px)",
          transformOrigin: "center center",
          mixBlendMode: "screen",
        }}
      />

      {/* Subtle fine grid overlay to give structure to the light */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)
          `,
          backgroundSize: '2rem 2rem',
        }}
      />

      {/* Dark vignette to focus the center river */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at center, transparent 30%, #000000 100%)",
        }}
      />
    </div>
  );
}
