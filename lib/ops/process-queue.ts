import "server-only";

import { randomUUID } from "node:crypto";

import { notifyPendingReview } from "@/lib/notifications";
import { isGenerationDryRun } from "@/lib/ops/generation-dry-run";
import { loadPrimaryGenerationPrompt } from "@/lib/ops/load-prompt";
import { requestImageViaOpenRouter } from "@/lib/ops/openrouter-image";
import {
  MAX_GENERATION_RUNS,
  type OrderPipelineStatus,
} from "@/lib/ops/sheet-columns";
import type { OrderSheetRow } from "@/lib/ops/sheet-columns";
import {
  fetchOrderSheetGrid,
  updateOrderRowCells,
} from "@/lib/ops/sheet-repository";
import { normalizeStyleId } from "@/lib/ops/style-masters";

const LOCK_MS = 10 * 60 * 1000;
const PICKABLE: OrderPipelineStatus[] = [
  "NEW",
  "READY_FOR_GENERATION",
  "REJECTED_NEEDS_REGEN",
];

function parseAttempt(v: string): number {
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function publicReviewUrl(orderId: string): string | undefined {
  const base =
    process.env.OPS_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "";
  if (!base) return undefined;
  return `${base}/review/order/${encodeURIComponent(orderId)}`;
}

function isLocked(row: OrderSheetRow): boolean {
  const raw = row.values["lock_until"]?.trim();
  if (!raw) return false;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export function isRowProcessable(row: OrderSheetRow): boolean {
  if (isLocked(row)) return false;
  const stRaw = row.values["status"]?.trim() || "NEW";
  const staleGenerating = stRaw === "GENERATING";
  const pickableBase = PICKABLE.includes(stRaw as OrderPipelineStatus);
  if (!staleGenerating && !pickableBase) return false;
  const attempt = parseAttempt(row.values["generation_attempt"] ?? "0");
  return attempt < MAX_GENERATION_RUNS;
}

export function pickNextProcessableRow(
  rows: OrderSheetRow[],
): OrderSheetRow | null {
  for (const row of rows) {
    if (isRowProcessable(row)) return row;
  }
  return null;
}

async function claimRow(row: OrderSheetRow): Promise<boolean> {
  const r = await updateOrderRowCells(row.rowNumber, {
    status: "GENERATING",
    lock_until: new Date(Date.now() + LOCK_MS).toISOString(),
    lock_token: randomUUID(),
    last_error: "",
  });
  return r.ok;
}

export async function processNextOrderInQueue(opts?: {
  /** Если передан (вебхук из Apps Script) — обрабатываем только эту строку, если она eligible */
  orderId?: string;
}): Promise<{
  processed: boolean;
  orderId?: string;
  detail: string;
}> {
  const grid = await fetchOrderSheetGrid();
  if (!grid) {
    return { processed: false, detail: "sheets not configured or read failed" };
  }

  let row: OrderSheetRow | null = null;
  if (opts?.orderId?.trim()) {
    const id = opts.orderId.trim();
    const found = grid.rows.find((r) => r.values["Order ID"]?.trim() === id);
    if (!found) {
      return { processed: false, orderId: id, detail: "orderId not found in sheet" };
    }
    if (!isRowProcessable(found)) {
      return {
        processed: false,
        orderId: id,
        detail: "row not eligible (status, lock, or generation limit)",
      };
    }
    row = found;
  } else {
    row = pickNextProcessableRow(grid.rows);
  }

  if (!row) {
    return { processed: false, detail: "no rows to process" };
  }

  const orderId = row.values["Order ID"]?.trim() ?? "";
  const claimed = await claimRow(row);
  if (!claimed) {
    return { processed: false, orderId, detail: "claim failed" };
  }

  const styleId = row.values["style_id"]?.trim() ?? "";
  const styleNorm = normalizeStyleId(styleId);
  if (!styleNorm) {
    await updateOrderRowCells(row.rowNumber, {
      status: "FAILED",
      last_error: "Неизвестный или пустой style_id",
      lock_until: "",
      lock_token: "",
    });
    return { processed: true, orderId, detail: "failed: bad style_id" };
  }

  const fileCount = parseInt(row.values["Кол-во файлов"] ?? "0", 10) || 0;
  if (fileCount <= 0) {
    await updateOrderRowCells(row.rowNumber, {
      status: "FAILED",
      last_error: "Нет фото питомца (Кол-во файлов = 0)",
      lock_until: "",
      lock_token: "",
    });
    return { processed: true, orderId, detail: "failed: no photos" };
  }

  const attempt = parseAttempt(row.values["generation_attempt"] ?? "0");
  const nextAttempt = attempt + 1;

  const shirt =
    row.values["Цвет футболки"]?.trim() ||
    (row.values["Футболки"]?.includes("черн")
      ? "black"
      : row.values["Футболки"]?.includes("бел")
        ? "white"
        : "white");

  let prompt: string;
  try {
    prompt = await loadPrimaryGenerationPrompt(styleNorm);
    prompt += `\n\nShirt color (for mockup/background if applicable): ${shirt}.`;
    const dogLine = row.values["Футболки"]?.split("\n")[0]?.trim();
    if (dogLine) {
      prompt += `\nDog name on print (keep language as in order): ${dogLine}.`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateOrderRowCells(row.rowNumber, {
      status: "FAILED",
      last_error: `prompt load: ${msg}`,
      lock_until: "",
      lock_token: "",
    });
    return { processed: true, orderId, detail: "failed: prompt" };
  }

  const gen = await requestImageViaOpenRouter({
    prompt,
    imageDataUrls: [],
  });

  if (!gen.ok) {
    await updateOrderRowCells(row.rowNumber, {
      status: "FAILED",
      last_error: gen.error,
      lock_until: "",
      lock_token: "",
    });
    return { processed: true, orderId, detail: `failed: ${gen.error}` };
  }

  if (
    !isGenerationDryRun() &&
    !gen.imageBase64 &&
    "needsImageParser" in gen &&
    gen.needsImageParser
  ) {
    await updateOrderRowCells(row.rowNumber, {
      status: "FAILED",
      last_error:
        "OpenRouter ответил без извлечённого изображения — настройте парсер под модель",
      lock_until: "",
      lock_token: "",
    });
    return { processed: true, orderId, detail: "failed: no image in response" };
  }

  const genUrl =
    isGenerationDryRun() || !gen.imageBase64
      ? "(dry-run — файл на Drive не создавался)"
      : `data:${gen.mimeType ?? "image/png"};base64,${gen.imageBase64}`;

  await updateOrderRowCells(row.rowNumber, {
    status: "PENDING_REVIEW",
    generation_attempt: String(nextAttempt),
    generated_image_url: genUrl.slice(0, 50000),
    lock_until: "",
    lock_token: "",
    last_error: "",
  });

  await notifyPendingReview({
    orderId,
    customerName: row.values["Имя"]?.trim(),
    reviewUrl: publicReviewUrl(orderId),
    attempt: nextAttempt,
  });

  return {
    processed: true,
    orderId,
    detail: isGenerationDryRun() ? "dry-run → PENDING_REVIEW" : "openrouter ok → PENDING_REVIEW",
  };
}
