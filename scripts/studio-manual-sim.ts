/**
 * Simulate the Telegram manual flows end-to-end in MOCK mode, with NO real
 * Telegram or Drive side effects. Verifies pack (photos→name→style),
 * dog_only, and name_only conversation state + mode-aware completion.
 *
 *   npx tsx --conditions react-server scripts/studio-manual-sim.ts
 */
process.env.STUDIO_MOCK_AI = "true";
process.env.STUDIO_DATABASE_URL = "file:data/studio/studio.db";
// Force the artifact upload path to a dead endpoint so approve never writes to real Drive.
process.env.GOOGLE_ORDER_WEBHOOK_URL = "http://127.0.0.1:9/disabled";
process.env.GOOGLE_ORDER_WEBHOOK_SECRET = "x";
// Deliberately DO NOT set TELEGRAM_BOT_TOKEN → tgSend / reviews no-op.
delete process.env.TELEGRAM_BOT_TOKEN;

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import {
  handleManualCallback,
  handleManualText,
} from "../lib/studio/telegram/manual-flow";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import { approveDogStage, approveTextStage } from "../lib/studio/pipeline/human-actions";
import { getStudioDataDir } from "../lib/studio/paths";

const CHAT = "test-chat-1";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxKDveksOskAAAAAElFTkSuQmCC",
  "base64",
);

async function sessionOrderId(): Promise<string> {
  const s = await getStudioDb()
    .select()
    .from(schema.studioTgSessions)
    .where(eq(schema.studioTgSessions.chatId, CHAT))
    .get();
  if (!s?.orderId) throw new Error("no session orderId");
  return s.orderId;
}

async function statusOf(orderId: string): Promise<string> {
  const [o] = await getStudioDb()
    .select({ status: schema.studioOrders.status, mode: schema.studioOrders.mode })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  return `${o.status} (mode=${o.mode})`;
}

async function tickUntil(orderId: string, target: string, label: string, max = 12) {
  for (let i = 1; i <= max; i++) {
    await runStudioPipelineTick();
    const [o] = await getStudioDb()
      .select({ status: schema.studioOrders.status })
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.id, orderId))
      .limit(1);
    console.log(`  [${label}] tick ${i}: ${o.status}`);
    if (o.status === target) return;
  }
  throw new Error(`${label}: never reached ${target}`);
}

async function injectPhoto(orderId: string) {
  const rel = path.posix.join("cache", orderId, `0_${randomUUID()}.png`);
  const abs = path.join(getStudioDataDir(), ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, TINY_PNG);
  await getStudioDb().insert(schema.studioOrderPhotos).values({
    id: randomUUID(),
    orderId,
    sortOrder: 0,
    driveFileId: "",
    originalName: "sim.png",
    mimeType: "image/png",
    localRelativePath: rel,
  });
}

async function cleanupOrders(...orderIds: string[]) {
  const db = getStudioDb();
  for (const oid of orderIds) {
    await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, oid));
    await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, oid));
    await db.delete(schema.studioAiCalls).where(eq(schema.studioAiCalls.orderId, oid));
    await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, oid));
  }
  await db.delete(schema.studioTgSessions).where(eq(schema.studioTgSessions.chatId, CHAT));
}

async function main() {
  // ---------- PACK FLOW (photos → name → style → dog+text) ----------
  console.log("== PACK flow (photos → name → style) ==");
  await handleManualCallback(CHAT, "mm:pack");
  const packOrder = await sessionOrderId();
  console.log("  created", await statusOf(packOrder));
  await injectPhoto(packOrder); // stand-in for Telegram photo (handleManualPhoto needs bot token)
  const named = await handleManualText(CHAT, "Bublik");
  console.log("  typed name →", named.handled, "|", await statusOf(packOrder));
  const started = await handleManualCallback(CHAT, "ms:pack:life");
  console.log("  style chosen → triggerTick:", started.triggerTick, "|", await statusOf(packOrder));
  if (!started.triggerTick) throw new Error("pack should trigger tick after style");
  await tickUntil(packOrder, "dog_awaiting_approval", "pack-dog");
  const pad = await approveDogStage(packOrder);
  console.log("  approveDog:", pad.ok, "→", await statusOf(packOrder));
  if ((await statusOf(packOrder)).indexOf("dog_approved_idle") < 0) {
    throw new Error("dog_text should continue to text after dog approve");
  }
  await tickUntil(packOrder, "text_awaiting_approval", "pack-text");
  const pat = await approveTextStage(packOrder);
  console.log("  approveText:", pat.ok, "→", await statusOf(packOrder));
  if ((await statusOf(packOrder)).indexOf("completed") < 0) {
    throw new Error("dog_text should complete on text approve");
  }

  // ---------- DOG FLOW ----------
  console.log("== DOG illustration flow ==");
  await handleManualCallback(CHAT, "mm:dog");
  await handleManualCallback(CHAT, "ms:dog:life");
  const dogOrder = await sessionOrderId();
  console.log("  created", await statusOf(dogOrder));
  await injectPhoto(dogOrder);
  const gen = await handleManualCallback(CHAT, "mg");
  console.log("  generate pressed → triggerTick:", gen.triggerTick, "|", await statusOf(dogOrder));
  await tickUntil(dogOrder, "dog_awaiting_approval", "dog");
  const ad = await approveDogStage(dogOrder);
  console.log("  approveDog:", ad.ok, "→", await statusOf(dogOrder));
  if ((await statusOf(dogOrder)).indexOf("completed") < 0) throw new Error("dog_only should complete on approve");

  // ---------- NAME FLOW ----------
  console.log("== NAME flow ==");
  await handleManualCallback(CHAT, "mm:name");
  await handleManualCallback(CHAT, "ms:name:speed");
  const nameOrder = await sessionOrderId();
  console.log("  created", await statusOf(nameOrder));
  const t = await handleManualText(CHAT, "Rex");
  console.log("  typed name → triggerTick:", t.triggerTick, "|", await statusOf(nameOrder));
  await tickUntil(nameOrder, "text_awaiting_approval", "name");
  const at = await approveTextStage(nameOrder);
  console.log("  approveText:", at.ok, "→", await statusOf(nameOrder));
  if ((await statusOf(nameOrder)).indexOf("completed") < 0) throw new Error("name_only should complete on approve");

  // Caption shortcut path: name via text after photos (caption uses same advancePackToStyle)
  console.log("== PACK name-after-photos again ==");
  await handleManualCallback(CHAT, "mm:pack");
  const capOrder = await sessionOrderId();
  await injectPhoto(capOrder);
  await handleManualCallback(CHAT, "mn"); // photos done → ask for name
  await handleManualText(CHAT, "Neko");
  await handleManualCallback(CHAT, "ms:pack:rainy");
  console.log("  after style:", await statusOf(capOrder));
  if ((await statusOf(capOrder)).indexOf("assets_loaded") < 0) {
    throw new Error("pack after name+style should be assets_loaded");
  }

  await cleanupOrders(packOrder, dogOrder, nameOrder, capOrder);

  console.log("\nMANUAL FLOW SIM PASSED ✅ (pack + dog_only + name_only)");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("MANUAL FLOW SIM FAILED ❌", e);
    process.exit(1);
  },
);
