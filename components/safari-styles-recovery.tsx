"use client";

import { useEffect } from "react";

const RELOAD_KEY = "dogood-css-recovery-v4";

/** Основной Tailwind CSS подключился (не только inline critical). */
function mainStylesheetLoaded(): boolean {
  if (typeof document === "undefined") return true;
  for (const sheet of document.styleSheets) {
    try {
      const href = sheet.href ?? "";
      if (href.includes("/_next/static/css/")) return true;
    } catch {
      /* cross-origin */
    }
  }
  return false;
}

/** Один reload, если CSS-файл так и не появился. */
export function SafariStylesRecovery() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (mainStylesheetLoaded()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    }, 8000);

    return () => window.clearTimeout(t);
  }, []);

  return null;
}
