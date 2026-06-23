"use client";

import React, { useEffect, useRef, type ReactNode } from "react";

const glowColorMap = {
  blue: { base: 220, spread: 200 },
  purple: { base: 280, spread: 300 },
  green: { base: 120, spread: 200 },
  red: { base: 0, spread: 200 },
  orange: { base: 30, spread: 200 },
} as const;

const sizeMap = {
  sm: "w-48 h-64",
  md: "w-64 h-80",
  lg: "w-80 h-96",
};

export type GlowColor = keyof typeof glowColorMap;

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: GlowColor;
  size?: "sm" | "md" | "lg";
  width?: string | number;
  height?: string | number;
  customSize?: boolean;
}

type PointerSubscriber = (event: PointerEvent) => void;

const pointerSubscribers = new Set<PointerSubscriber>();
let pointerListenerAttached = false;

function dispatchPointerMove(event: PointerEvent) {
  pointerSubscribers.forEach((subscriber) => subscriber(event));
}

function attachSharedPointerListener() {
  if (pointerListenerAttached || typeof window === "undefined") return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  document.addEventListener("pointermove", dispatchPointerMove);
  pointerListenerAttached = true;
}

function detachSharedPointerListener() {
  if (!pointerListenerAttached || pointerSubscribers.size > 0) return;
  document.removeEventListener("pointermove", dispatchPointerMove);
  pointerListenerAttached = false;
}

function subscribePointerMove(subscriber: PointerSubscriber) {
  pointerSubscribers.add(subscriber);
  attachSharedPointerListener();
  return () => {
    pointerSubscribers.delete(subscriber);
    detachSharedPointerListener();
  };
}

export function GlowCard({
  children,
  className = "",
  glowColor = "purple",
  size = "md",
  width,
  height,
  customSize = false,
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      return;
    }
    const syncPointer = (e: PointerEvent) => {
      const { clientX: x, clientY: y } = e;
      if (cardRef.current) {
        cardRef.current.style.setProperty("--x", x.toFixed(2));
        cardRef.current.style.setProperty(
          "--xp",
          (x / window.innerWidth).toFixed(2),
        );
        cardRef.current.style.setProperty("--y", y.toFixed(2));
        cardRef.current.style.setProperty(
          "--yp",
          (y / window.innerHeight).toFixed(2),
        );
      }
    };
    return subscribePointerMove(syncPointer);
  }, []);

  const { base, spread } = glowColorMap[glowColor];

  const getSizeClasses = () => {
    if (customSize) return "";
    return sizeMap[size];
  };

  const getInlineStyles = (): React.CSSProperties => {
    const baseStyles: React.CSSProperties = {
      ["--base" as string]: base,
      ["--spread" as string]: spread,
      ["--radius" as string]: "20",
      ["--border" as string]: "2",
      ["--backdrop" as string]: "hsl(0 0% 100% / 0.86)",
      ["--backup-border" as string]: "var(--backdrop)",
      ["--size" as string]: "220",
      ["--outer" as string]: "1",
      ["--border-size" as string]: "calc(var(--border, 2) * 1px)",
      ["--spotlight-size" as string]: "calc(var(--size, 150) * 1px)",
      ["--hue" as string]:
        "calc(var(--base) + (var(--xp, 0) * var(--spread, 0)))",
      backgroundImage: `radial-gradient(
        var(--spotlight-size) var(--spotlight-size) at
        calc(var(--x, 0) * 1px)
        calc(var(--y, 0) * 1px),
        hsl(var(--hue, 210) calc(var(--saturation, 100) * 1%) calc(var(--lightness, 55) * 1%) / var(--bg-spot-opacity, 0.12)), transparent
      )`,
      backgroundColor: "var(--backdrop, transparent)",
      backgroundSize:
        "calc(100% + (2 * var(--border-size))) calc(100% + (2 * var(--border-size)))",
      backgroundPosition: "50% 50%",
      backgroundAttachment: "scroll",
      border: "var(--border-size) solid var(--backup-border)",
      position: "relative",
      touchAction: "auto",
    };
    if (width !== undefined) {
      baseStyles.width = typeof width === "number" ? `${width}px` : width;
    }
    if (height !== undefined) {
      baseStyles.height = typeof height === "number" ? `${height}px` : height;
    }
    return baseStyles;
  };

  return (
    <div
      ref={cardRef}
      data-glow
      style={getInlineStyles()}
      className={`
          ${getSizeClasses()}
          ${!customSize ? "aspect-[3/4] grid grid-rows-[1fr_auto]" : "flex min-h-0 w-full flex-col"}
          rounded-2xl 
          relative 
      shadow-[0_16px_40px_rgba(168,85,247,0.12)] 
          p-4 
          gap-4 
          backdrop-blur-[6px]
          ${className}
        `}
    >
      <div ref={innerRef} data-glow aria-hidden />
      <div className="relative z-10 flex min-h-0 w-full min-w-0 flex-col gap-4">
        {children}
      </div>
    </div>
  );
}
