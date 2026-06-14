import "server-only";

import fs from "node:fs/promises";

import { eq } from "drizzle-orm";

import { styleDisplayName } from "@/lib/ops/style-masters";
import type { StyleSlug } from "@/lib/ops/style-masters";
import { getStudioDb, schema } from "@/lib/studio/db";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

const BOT_API = "https://api.telegram.org";

function getToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim();
}

function getChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID?.trim();
}

export function isTelegramReviewEnabled(): boolean {
  return Boolean(getToken() && getChatId() && process.env.OPS_NOTIFY_TELEGRAM?.trim() === "true");
}

async function tgPost(method: string, body: Record<string, unknown>) {
  const token = getToken();
  if (!token) return { ok: false as const, error: "no token" };
  const res = await fetch(`${BOT_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false as const, error: raw.slice(0, 400) };
  return { ok: true as const, raw };
}

async function sendPhoto(pathAbs: string, caption: string) {
  const token = getToken();
  const chatId = getChatId();
  if (!token || !chatId) return { ok: false, error: "telegram not configured" };
  const buf = await fs.readFile(pathAbs);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 900));
  form.append("photo", new Blob([buf]), "preview.png");
  const res = await fetch(`${BOT_API}/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

export async function sendStudioReviewRequest(orderId: string, stage: "dog" | "text" | "final"): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isTelegramReviewEnabled()) return { ok: false, error: "telegram disabled" };

  const db = getStudioDb();
  const order = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .get();
  if (!order) return { ok: false, error: "order not found" };

  const style = styleDisplayName(order.designSlug as StyleSlug);
  const header = [
    `DoGood review: ${stage.toUpperCase()}`,
    `Order: ${order.sheetOrderId}`,
    `Pet: ${order.petNameRaw}`,
    `Style: ${style}`,
    "",
    "Reply with:",
    `/approve_${stage}_${order.sheetOrderId}`,
    `/reject_${stage}_${order.sheetOrderId} your comment (optional)`,
  ].join("\n");

  await tgPost("sendMessage", { chat_id: getChatId(), text: header });

  const photos = await db
    .select()
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId))
    .limit(3);

  for (const p of photos) {
    const abs = absoluteFromStudioRelative(p.localRelativePath);
    await sendPhoto(abs, `Client photo: ${p.originalName}`);
  }

  let artifact = "";
  if (stage === "dog") {
    const runs = await db
      .select()
      .from(schema.studioStepRuns)
      .where(eq(schema.studioStepRuns.orderId, orderId));
    const dogImg = runs
      .filter((r) => r.stepKey.startsWith("DOG_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    artifact = dogImg?.outputArtifactPath ?? "";
  } else if (stage === "text") {
    artifact = order.approvedDogArtifactPath;
    const runs = await db.select().from(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, orderId));
    const textImg = runs
      .filter((r) => r.stepKey.startsWith("TEXT_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    if (textImg?.outputArtifactPath) artifact = textImg.outputArtifactPath;
  } else {
    const runs = await db.select().from(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, orderId));
    const finalImg = runs
      .filter((r) => r.stepKey.startsWith("FINAL_IMG") && r.status === "success" && r.outputArtifactPath)
      .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0];
    artifact = finalImg?.outputArtifactPath ?? "";
  }

  if (artifact) {
    await sendPhoto(absoluteFromStudioRelative(artifact), `Generated ${stage}`);
  }

  await db
    .update(schema.studioOrders)
    .set({ reviewNotifiedFor: stage, updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));

  return { ok: true };
}

export async function handleTelegramCommand(text: string): Promise<string> {
  const t = text.trim();
  const approve = t.match(/^\/approve_(dog|text|final)_(\S+)/i);
  if (approve) {
    const [, stage, sheetOrderId] = approve;
    const db = getStudioDb();
    const order = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
      .get();
    if (!order) return `Order not found: ${sheetOrderId}`;
    const { approveDogStage, approveTextStage, approveFinalStage } = await import(
      "@/lib/studio/pipeline/human-actions"
    );
    if (stage === "dog") {
      const r = await approveDogStage(order.id);
      return r.ok ? `Dog approved for ${sheetOrderId}` : `Dog approve failed: ${r.error}`;
    }
    if (stage === "text") {
      const r = await approveTextStage(order.id);
      return r.ok ? `Text approved for ${sheetOrderId}` : `Text approve failed: ${r.error}`;
    }
    const r = await approveFinalStage(order.id);
    return r.ok ? `Final approved for ${sheetOrderId}` : `Final approve failed: ${r.error}`;
  }

  const reject = t.match(/^\/reject_(dog|text|final)_(\S+)\s*([\s\S]*)$/i);
  if (reject) {
    const [, stage, sheetOrderId, note] = reject;
    const db = getStudioDb();
    const order = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetOrderId))
      .get();
    if (!order) return `Order not found: ${sheetOrderId}`;
    const noteTrim = (note ?? "").trim();
    await db
      .update(schema.studioOrders)
      .set({
        humanRejectNote: noteTrim,
        reviewNotifiedFor: "",
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, order.id));

    const { rejectDogStage, rejectTextStage, rejectFinalStage } = await import(
      "@/lib/studio/pipeline/human-actions"
    );
    if (stage === "dog") {
      await rejectDogStage(order.id, noteTrim || "Human rejected — AI will suggest corrections");
      return `Dog rejected for ${sheetOrderId}. Regeneration queued.`;
    }
    if (stage === "text") {
      await rejectTextStage(order.id, noteTrim || "Human rejected — AI will suggest corrections");
      return `Text rejected for ${sheetOrderId}. Regeneration queued.`;
    }
    await rejectFinalStage(order.id, noteTrim || "Human rejected — AI will suggest corrections");
    return `Final rejected for ${sheetOrderId}. Regeneration queued.`;
  }

  return "Commands: /approve_dog_ORDERID, /reject_dog_ORDERID comment";
}
