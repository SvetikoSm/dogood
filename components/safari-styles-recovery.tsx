"use client";

import { useEffect } from "react";

const RELOAD_KEY = "dogood-css-recovery-v1";

/** Tailwind .hidden применился — основной CSS загружен. */
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
  sessionStorage.setItem(RELOAD_KEY, reason);
  window.location.reload();
}

/**
 * Safari/iOS: если CSS не подтянулся или страница из bfcache без стилей —
 * один автоматический reload без действий пользователя.
 */
export function SafariStylesRecovery() {
  useEffect(() => {
    const check = () => {
      if (!tailwindLoaded()) {
        reloadOnce("missing-css");
      }
    };

    const t = window.setTimeout(check, 800);

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        reloadOnce("bfcache");
      } else {
        window.setTimeout(check, 300);
      }
    };

    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return null;
}
