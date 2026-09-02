import "server-only";

import type { StyleSlug } from "@/lib/ops/style-masters";

/** Defaults from n8n workflow + user Drive layout (override via env). */
export const STUDIO_DRIVE_FOLDERS = {
  approved: "1-n0MWLhsxWG6_Rz9GMCp4LG9xYd2oiaQ",
  suboptimal: "18NOK4zhmm-GsHdXs9lKjQqnHsMyWMLxg",
  textBadges: "1eB9OI-KYKFb3s4LdiVBEnVOTwxSZGjtl",
  petStyleRefs: "1VcahlOwbGHCqK8iK3HULf4wENu2mTefq",
  textStyleRefs: "17K50Hx83nj4OBGgMLjM_8Qqzio1VXNqu",
  mockupMasters: "1cqXzHfe1xByc1aFOlCZLbAGXyH-gISJ0",
} as const;

/** n8n text style ref file IDs (style index 1=speed, 2=life, 3=rainy in form; we map by slug). */
export const N8N_TEXT_STYLE_REF_FILE_IDS: Record<StyleSlug, string> = {
  speed: "1d82ZNmOIg0yI0lyYRqEGxCzxGNPcilcu",
  life: "1EWNo0O6dS5xdz_8FAL_3uRVi8Fj1Pt0L",
  rainy: "11aMZ0rLuqVuqKBFPCHiNNFeo-BymnyJq",
};

/** Mockup master filenames on Drive (folder mockupMasters). */
export const MOCKUP_MASTER_FILENAMES: Record<StyleSlug, string[]> = {
  speed: ["Я - скорость", "Я — скорость", "I am speed", "Design 1. I am speed"],
  life: ["Life is better", "Design 2. Life is better"],
  rainy: ["No rainy days", "Design 3. No rainy days"],
};

export function getStudioDriveFolder(
  key: keyof typeof STUDIO_DRIVE_FOLDERS,
): string {
  const envKey = `STUDIO_DRIVE_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_FOLDER_ID`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  const legacy: Partial<Record<keyof typeof STUDIO_DRIVE_FOLDERS, string>> = {
    approved: process.env.STUDIO_DRIVE_APPROVED_FOLDER_ID?.trim(),
    mockupMasters: process.env.STUDIO_DRIVE_MOCKUP_FOLDER_ID?.trim(),
    petStyleRefs: process.env.STUDIO_DRIVE_PET_REFS_FOLDER_ID?.trim(),
    textStyleRefs: process.env.STUDIO_DRIVE_TEXT_REFS_FOLDER_ID?.trim(),
    textBadges: process.env.STUDIO_DRIVE_TEXT_BADGES_FOLDER_ID?.trim(),
  };
  return legacy[key] || STUDIO_DRIVE_FOLDERS[key];
}

export const STUDIO_SHEET_DEFAULTS = {
  spreadsheetId: "1v0qR8kUcEICstHSo-R1yluzxarepLmL2B_cSTd1KN1Y",
  tabName: "DOGOOD",
  petNameColumn: "Кличка",
  styleColumn: "Стиль (id, 1-я)",
  driveFolderColumn: "Папка с фото",
  orderIdColumn: "Order ID",
} as const;

export function getStudioSpreadsheetId(): string | undefined {
  return (
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
    STUDIO_SHEET_DEFAULTS.spreadsheetId
  );
}

export function getStudioSheetTabName(): string {
  return process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || STUDIO_SHEET_DEFAULTS.tabName;
}

/** Generation budget per stage (owner's norm: ~4 image generations per order). */
export const STUDIO_MAX_DOG_GENERATIONS = 4;
export const STUDIO_MAX_TEXT_GENERATIONS = 2;
export const STUDIO_MAX_FINAL_GENERATIONS = 2;

/** Automated-step failure handling: back off, then give up with an alert. */
export const STUDIO_STEP_RETRY_BACKOFF_MINUTES = [5, 15, 60] as const;
export const STUDIO_MAX_STEP_RETRIES = STUDIO_STEP_RETRY_BACKOFF_MINUTES.length;

/**
 * Fair-event orders retry in seconds, not minutes: a customer is standing at
 * the stand waiting, so a 5-minute backoff is the same as losing the sale.
 */
export const STUDIO_STEP_RETRY_BACKOFF_SECONDS_FAIR = [15, 45, 120] as const;

/** One cron tick keeps running steps until this time budget is spent. */
export const STUDIO_TICK_BUDGET_MS = 180_000;
export const STUDIO_TICK_LOCK_MS = 300_000;

/** A lane (order+stage) holds its claim this long while one step runs. */
export const STUDIO_LANE_LOCK_MS = 300_000;

/**
 * How many lanes (order+stage pairs) may run their AI calls at the same time.
 * The number of AI calls is unchanged — only their concurrency — so this does
 * not affect cost, just wall-clock latency and provider rate-limit pressure.
 * Default raised from 4 to 6: an image generation call is ~110s of network
 * wait, not CPU work, so more of them can run at once safely. Override with
 * STUDIO_MAX_CONCURRENT_LANES; capped so a typo can't hammer the image provider.
 */
export function getStudioMaxConcurrentLanes(): number {
  const raw = Number(process.env.STUDIO_MAX_CONCURRENT_LANES?.trim());
  if (!Number.isFinite(raw) || raw < 1) return 6;
  return Math.min(Math.floor(raw), 12);
}

/**
 * Fair-only mode: the pipeline skips website/sheet orders (mode="full") while
 * the fair event runs; they are handled manually instead. Fair-bot orders and
 * the owner’s manual Telegram orders still run. Flip STUDIO_FAIR_ONLY off
 * afterwards to resume website orders.
 */
export function isStudioFairOnly(): boolean {
  return process.env.STUDIO_FAIR_ONLY?.trim() === "true";
}
