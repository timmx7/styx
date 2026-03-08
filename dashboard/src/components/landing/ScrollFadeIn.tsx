"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface ScrollFadeInProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

export function ScrollFadeIn({ children, delay = 0, className }: ScrollFadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{
        duration: 0.8,
        delay,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
