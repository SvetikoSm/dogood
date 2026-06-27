"use client";

import { useEffect } from "react";

const RELOAD_KEY = "dogood-css-recovery-v2";

function tailwindLoaded(): boolean {
  const probe = document.createElement("div");
  probe.className = "hidden";
  probe.setAttribute("aria-hidden", "true");
  document.body.appendChild(probe);
  const ok = getComputedStyle(probe).display === "none";
  probe.remove();
  return ok;
}

function reloadOnce(reason: string) {
  if (typeof sessionStorage === "undefined") return;
  if (sessionStorage.getItem(RELOAD_KEY)) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  sessionStorage.setItem(RELOAD_KEY, reason);
  window.location.reload();
}

/**
 * Один мягкий reload, если CSS не подтянулся. Без reload из bfcache — лишняя нагрузка на сеть.
 */
export function SafariStylesRecovery() {
  useEffect(() => {
    const check = () => {
      if (!tailwindLoaded()) reloadOnce("missing-css");
    };

    const t = window.setTimeout(check, 3000);

    return () => window.clearTimeout(t);
  }, []);

  return null;
}
