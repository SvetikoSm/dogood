"use client";

import { useEffect } from "react";

const RELOAD_KEY = "dogood-css-recovery-v3";

function tailwindLoaded(): boolean {
  const probe = document.createElement("div");
  probe.className = "hidden";
  probe.setAttribute("aria-hidden", "true");
  document.body.appendChild(probe);
  const ok = getComputedStyle(probe).display === "none";
  probe.remove();
  return ok;
}

/** Один reload только если онлайн и CSS так и не подтянулся через 5с. */
export function SafariStylesRecovery() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (tailwindLoaded()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    }, 5000);

    return () => window.clearTimeout(t);
  }, []);

  return null;
}
