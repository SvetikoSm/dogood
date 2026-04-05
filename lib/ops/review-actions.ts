import "server-only";

import { MAX_GENERATION_RUNS } from "@/lib/ops/sheet-columns";
import {
  findRowByOrderId,
  updateOrderRowCells,
} from "@/lib/ops/sheet-repository";

function parseAttempt(v: string): number {
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function approveOrder(orderId: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const row = await findRowByOrderId(orderId);
  if (!row) return { ok: false, error: "order not found" };
  if (row.values["status"]?.trim() !== "PENDING_REVIEW") {
    return { ok: false, error: "not in PENDING_REVIEW" };
  }
  const genUrl = row.values["generated_image_url"]?.trim() ?? "";
  const r = await updateOrderRowCells(row.rowNumber, {
    status: "APPROVED",
    approved_image_url: genUrl,
    review_comment: "",
    last_error: "",
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function rejectOrder(
  orderId: string,
  opts: { comment: string; regenerate: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await findRowByOrderId(orderId);
  if (!row) return { ok: false, error: "order not found" };
  if (row.values["status"]?.trim() !== "PENDING_REVIEW") {
    return { ok: false, error: "not in PENDING_REVIEW" };
  }

  const attempt = parseAttempt(row.values["generation_attempt"] ?? "0");
  const comment = opts.comment.trim().slice(0, 2000);

  if (opts.regenerate) {
    if (attempt >= MAX_GENERATION_RUNS) {
      const r = await updateOrderRowCells(row.rowNumber, {
        status: "GENERATION_LIMIT",
        review_comment: comment,
        last_error: `Лимит генераций (${MAX_GENERATION_RUNS})`,
      });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    const r = await updateOrderRowCells(row.rowNumber, {
      status: "READY_FOR_GENERATION",
      review_comment: comment,
      last_error: "",
    });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  const r = await updateOrderRowCells(row.rowNumber, {
    status: "REJECTED_NEEDS_REGEN",
    review_comment: comment,
    last_error: "",
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
