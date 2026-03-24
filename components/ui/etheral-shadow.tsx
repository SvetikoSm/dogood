"use client";

import React, { type CSSProperties } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Фон hero: мягкая маска + шум + лёгкая пульсация (упрощённая версия «ethereal»). */
export function EtherealShadow({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "relative min-h-[72vh] w-full overflow-hidden bg-neutral-950",
        className,
      )}
      style={style}
    >
      <motion.div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundColor: "rgba(120, 40, 90, 0.75)",
          maskImage: `url('https://framerusercontent.com/images/ceBGguIpUU8luwByxuQz79t7To.png')`,
          maskSize: "cover",
          maskRepeat: "no-repeat",
          maskPosition: "center",
        }}
        animate={{ opacity: [0.45, 0.78, 0.45] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: `url("https://framerusercontent.com/images/g0QcWrxr87K0ufOxIUFBakwYA8.png")`,
          backgroundSize: "180px",
          backgroundRepeat: "repeat",
        }}
        aria-hidden
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
