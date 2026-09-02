/**
 * FIX-7 verification: lanes (order+stage) run CONCURRENTLY — dog ‖ text inside
 * one order, and across orders — without ever mixing one customer's dog with
 * another's pet name.
 *
 * All assertions are deterministic (state + step-run rows), never wall-clock
 * timings, so this is stable in CI and in mock mode where steps are instant.
 *
 *   npx tsx --conditions react-server scripts/fair-parallel-e2e.ts
 */
process.env.STUDIO_MOCK_AI = "true";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import { ensureStudioSchema } from "../lib/studio/db/ensure-schema";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import { getStudioDataDir } from "../lib/studio/paths";
import { handleFairPhoto, handleFairText } from "../lib/studio/telegram/fair-flow";

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOskAAAAAElFTkSuQmCC";

/**
 * A "website" order (mode="full", same parallel dog+text lanes as "fair") in
 * status=assets_loaded WITH a photo already attached, so resolveIngestStep
 * moves it straight to in_progress instead of running FETCH_DRIVE_PHOTOS —
 * which would otherwise make a real Google Drive API call for a fake folder id.
 */
async function seedWebsiteOrder(
  id: string,
  createdAt?: Date,
  mode: "full" | "dog_text" = "full",
): Promise<void> {
  const db = getStudioDb();
  await db.insert(schema.studioOrders).values({
    id,
    sheetOrderId: id,
    customerName: "website-test",
    petNameRaw: "Тест",
    petNameScript: "cyrillic",
    designSlug: "life",
    status: "assets_loaded",
    mode,
    sheetPayloadJson: "{}",
    ...(createdAt ? { createdAt } : {}),
  });
  const rel = path.posix.join("cache", id, "0_seed.png");
  const abs = path.join(getStudioDataDir(), ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(MOCK_PNG_BASE64, "base64"));
  await db.insert(schema.studioOrderPhotos).values({
    id: randomUUID(),
    orderId: id,
    sortOrder: 0,
    driveFileId: "",
    originalName: "seed.png",
    mimeType: "image/png",
    localRelativePath: rel,
  });
}

async function removeOrder(id: string): Promise<void> {
  const db = getStudioDb();
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, id));
  await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, id));
  await db.delete(schema.studioLaneState).where(eq(schema.studioLaneState.orderId, id));
  await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, id));
}

async function removeFairClient(chatId: string): Promise<void> {
  const db = getStudioDb();
  const [row] = await db
    .select({ id: schema.studioFairOrders.id, orderId: schema.studioFairOrders.orderId })
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, chatId))
    .limit(1);
  if (!row) return;
  await db.delete(schema.studioFairOrders).where(eq(schema.studioFairOrders.id, row.id));
  await removeOrder(row.orderId);
}

const CLIENTS = [
  { chatId: "PARALLEL_CHAT_A", petName: "Альфа", email: "alpha@example.com" },
  { chatId: "PARALLEL_CHAT_B", petName: "Бета", email: "beta@example.com" },
  { chatId: "PARALLEL_CHAT_C", petName: "Гамма", email: "gamma@example.com" },
];

const CHAT_IDS = CLIENTS.map((c) => c.chatId);

async function cleanup(): Promise<void> {
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioFairOrders.id, orderId: schema.studioFairOrders.orderId })
    .from(schema.studioFairOrders)
    .where(inArray(schema.studioFairOrders.chatId, CHAT_IDS));
  for (const r of rows) {
    await db.delete(schema.studioFairOrders).where(eq(schema.studioFairOrders.id, r.id));
    await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, r.orderId));
    await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, r.orderId));
    await db.delete(schema.studioLaneState).where(eq(schema.studioLaneState.orderId, r.orderId));
    await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, r.orderId));
  }
}

async function fairRowFor(chatId: string) {
  const db = getStudioDb();
  const [row] = await db
    .select()
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, chatId))
    .limit(1);
  if (!row) throw new Error(`fair row missing for ${chatId}`);
  return row;
}

async function orderRow(orderId: string) {
  const db = getStudioDb();
  const [o] = await db.select().from(schema.studioOrders).where(eq(schema.studioOrders.id, orderId)).limit(1);
  if (!o) throw new Error("order missing");
  return o;
}

async function stepRunsFor(orderId: string) {
  const db = getStudioDb();
  return db.select().from(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, orderId));
}

async function main() {
  await ensureStudioSchema();
  await cleanup();

  // --- Three customers submit at (effectively) the same time.
  for (const c of CLIENTS) {
    await handleFairPhoto(c.chatId, `mock-${c.chatId}`);
    await handleFairText(c.chatId, c.petName);
    await handleFairText(c.chatId, c.email);
  }
  const fairRows = await Promise.all(CLIENTS.map((c) => fairRowFor(c.chatId)));
  const orderIds = fairRows.map((r) => r.orderId);
  console.log("intake OK:", orderIds.length, "orders queued");

  // === 1. Cross-order parallelism ==========================================
  // Before FIX-7 a single tick advanced exactly ONE order (pickWorkingOrder
  // had limit 1). Now one tick must touch at least two different orders.
  const firstTick = await runStudioPipelineTick();
  console.log("tick 1:", firstTick.detail.slice(0, 400));

  const ordersTouched = new Set<string>();
  for (const orderId of orderIds) {
    if ((await stepRunsFor(orderId)).length > 0) ordersTouched.add(orderId);
  }
  if (ordersTouched.size < 2) {
    throw new Error(
      `cross-order parallelism failed: one tick advanced ${ordersTouched.size} order(s), expected >= 2`,
    );
  }
  console.log(`cross-order parallelism OK: one tick advanced ${ordersTouched.size} orders`);

  // === 2. In-order parallelism (dog ‖ text) ================================
  // A single tick's detail must show BOTH stages progressing for the same
  // order — the dog lane no longer blocks the text lane.
  const sheetIds = await Promise.all(orderIds.map(async (id) => (await orderRow(id)).sheetOrderId));
  const bothStagesInOneTick = sheetIds.some(
    (sid) =>
      firstTick.detail.includes(`for ${sid}/dog`) && firstTick.detail.includes(`for ${sid}/text`),
  );
  if (!bothStagesInOneTick) {
    throw new Error(`in-order parallelism failed: no order ran dog AND text in one tick\n${firstTick.detail}`);
  }
  console.log("in-order parallelism OK: dog and text lanes ran for the same order in one tick");

  // Drive everything to the review gate.
  for (let i = 0; i < 10; i++) {
    const states = await Promise.all(orderIds.map((id) => orderRow(id)));
    if (states.every((o) => o.dogStatus === "awaiting_approval" && o.textStatus === "awaiting_approval")) break;
    const r = await runStudioPipelineTick();
    console.log(`drain tick ${i + 2}:`, r.detail.slice(0, 200));
  }
  const finalStates = await Promise.all(orderIds.map((id) => orderRow(id)));
  for (const o of finalStates) {
    if (o.dogStatus !== "awaiting_approval" || o.textStatus !== "awaiting_approval") {
      throw new Error(`order ${o.sheetOrderId} stuck: dog=${o.dogStatus} text=${o.textStatus}`);
    }
  }
  console.log("all three orders reached the review gate on both stages");

  // === 3. No cross-contamination ===========================================
  const seenArtifacts = new Map<string, string>(); // artifact path -> orderId
  for (let i = 0; i < CLIENTS.length; i++) {
    const orderId = orderIds[i];
    const client = CLIENTS[i];
    const order = await orderRow(orderId);

    if (order.petNameRaw !== client.petName) {
      throw new Error(`pet name mismatch for ${client.chatId}: order has "${order.petNameRaw}", expected "${client.petName}"`);
    }
    const fair = await fairRowFor(client.chatId);
    if (fair.petName !== client.petName || fair.orderId !== orderId) {
      throw new Error(`fair row mismatch for ${client.chatId}`);
    }

    for (const run of await stepRunsFor(orderId)) {
      if (!run.outputArtifactPath) continue;
      if (!run.outputArtifactPath.startsWith(`artifacts/${orderId}/`)) {
        throw new Error(
          `artifact of another order leaked into ${client.petName}: ${run.outputArtifactPath}`,
        );
      }
      const owner = seenArtifacts.get(run.outputArtifactPath);
      if (owner && owner !== orderId) {
        throw new Error(`artifact ${run.outputArtifactPath} shared between two orders`);
      }
      seenArtifacts.set(run.outputArtifactPath, orderId);
    }
  }
  console.log(`no-cross-contamination OK: ${seenArtifacts.size} artifacts, each owned by exactly one order`);

  // === 4. Lane exclusivity under concurrent ticks ==========================
  // Two ticks fired at once must not double-run a lane. Reset one order back
  // to "needs work" and race two ticks against it.
  const raceOrderId = orderIds[0];
  const db = getStudioDb();
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, raceOrderId));
  await db
    .update(schema.studioOrders)
    .set({
      status: "in_progress",
      dogStatus: "pending",
      textStatus: "pending",
      dogNotified: false,
      textNotified: false,
      humanRejectNote: "",
      textRejectNote: "",
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, raceOrderId));

  const [tickA, tickB] = await Promise.all([runStudioPipelineTick(), runStudioPipelineTick()]);
  console.log("race tick A:", tickA.detail.slice(0, 160));
  console.log("race tick B:", tickB.detail.slice(0, 160));

  const raceRuns = await stepRunsFor(raceOrderId);
  const successCounts = new Map<string, number>();
  for (const r of raceRuns) {
    if (r.status !== "success") continue;
    successCounts.set(r.stepKey, (successCounts.get(r.stepKey) ?? 0) + 1);
  }
  for (const [stepKey, count] of successCounts) {
    if (count > 1) {
      throw new Error(`lane exclusivity failed: ${stepKey} ran ${count} times for one order`);
    }
  }
  console.log("lane exclusivity OK: no step double-ran under concurrent ticks");

  // === 5. Failure isolation ===============================================
  // Park the text lane of one order; the dog lane of the SAME order must keep
  // working and the order must not be flipped to status="error".
  const isolationOrderId = orderIds[1];
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, isolationOrderId));
  await db
    .update(schema.studioOrders)
    .set({
      status: "in_progress",
      dogStatus: "pending",
      textStatus: "pending",
      dogNotified: false,
      textNotified: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, isolationOrderId));
  await db.insert(schema.studioLaneState).values({
    orderId: isolationOrderId,
    stage: "text",
    retryCount: 1,
    nextRetryAt: new Date(Date.now() + 60 * 60 * 1000), // blocked for an hour
    lastError: "simulated failure",
  });

  for (let i = 0; i < 5; i++) {
    const o = await orderRow(isolationOrderId);
    if (o.dogStatus === "awaiting_approval") break;
    await runStudioPipelineTick();
  }

  const isolated = await orderRow(isolationOrderId);
  if (isolated.status === "error") {
    throw new Error("failure isolation failed: a blocked text lane parked the whole order as error");
  }
  if (isolated.dogStatus !== "awaiting_approval") {
    throw new Error(`failure isolation failed: dog lane did not progress (dog=${isolated.dogStatus})`);
  }
  const isolationRuns = await stepRunsFor(isolationOrderId);
  if (isolationRuns.some((r) => r.stepKey.startsWith("TEXT_"))) {
    throw new Error("failure isolation failed: the blocked text lane ran anyway");
  }
  console.log("failure isolation OK: blocked text lane did not stop the dog lane or park the order");

  // Blocked lane must still be respected as data, not silently cleared.
  const [textLaneState] = await db
    .select()
    .from(schema.studioLaneState)
    .where(
      and(eq(schema.studioLaneState.orderId, isolationOrderId), eq(schema.studioLaneState.stage, "text")),
    )
    .limit(1);
  if (!textLaneState?.nextRetryAt || textLaneState.nextRetryAt.getTime() < Date.now()) {
    throw new Error("failure isolation failed: text lane backoff was cleared by another lane's success");
  }

  // === 6. Fair-only mode ====================================================
  // STUDIO_FAIR_ONLY must exclude website (mode="full") orders from the
  // pipeline entirely — not just deprioritize them.
  console.log("\n--- FIX-1: fair-only mode ---");
  const fairOnlyChat = "FAIRONLY_CHAT_X";
  await handleFairPhoto(fairOnlyChat, `mock-${fairOnlyChat}`);
  await handleFairText(fairOnlyChat, "Дельта");
  await handleFairText(fairOnlyChat, "delta@example.com");
  const fairOnlyOrderId = (await fairRowFor(fairOnlyChat)).orderId;

  const websiteOrderIds = ["TEST_WEBSITE_ORDER_1", "TEST_WEBSITE_ORDER_2"];
  for (const id of websiteOrderIds) await seedWebsiteOrder(id);

  // The owner’s own manual Telegram order must still run during the event:
  // it is a deliberate one-off request, not part of the website backlog.
  const manualOrderId = "TEST_MANUAL_ORDER_1";
  await seedWebsiteOrder(manualOrderId, undefined, "dog_text");

  process.env.STUDIO_FAIR_ONLY = "true";
  try {
    const fairOnlyTick = await runStudioPipelineTick();
    console.log("fair-only tick:", fairOnlyTick.detail.slice(0, 300));

    for (const id of websiteOrderIds) {
      const runs = await stepRunsFor(id);
      if (runs.length > 0) {
        throw new Error(
          `fair-only mode failed: website order ${id} got ${runs.length} step run(s), expected 0`,
        );
      }
    }
    const fairOnlyRuns = await stepRunsFor(fairOnlyOrderId);
    if (fairOnlyRuns.length === 0) {
      throw new Error("fair-only mode failed: the fair order itself did not progress");
    }
    const manualRuns = await stepRunsFor(manualOrderId);
    if (manualRuns.length === 0) {
      throw new Error(
        "fair-only mode failed: the owner’s manual order was excluded from the pipeline",
      );
    }
    console.log(
      `fair-only mode OK: website orders untouched (0 step runs each), fair order progressed (${fairOnlyRuns.length} step run(s)), manual order progressed (${manualRuns.length} step run(s))`,
    );
  } finally {
    process.env.STUDIO_FAIR_ONLY = "";
    for (const id of websiteOrderIds) await removeOrder(id);
    await removeOrder(manualOrderId);
    await removeFairClient(fairOnlyChat);
  }

  // === 7. Priority + atomic lane grouping under real contention ============
  // Six older "full" orders (2 lanes each = 12) alone exceed the 6-lane
  // default limit, so if fair orders weren't sorted first, the fair order's
  // dog+text pair could be starved or split across ticks.
  console.log("\n--- FIX-2/FIX-3: fair priority + no split lanes under contention ---");
  const priorityChat = "PRIORITY_CHAT_Y";
  await handleFairPhoto(priorityChat, `mock-${priorityChat}`);
  await handleFairText(priorityChat, "Эпсилон");
  await handleFairText(priorityChat, "epsilon@example.com");
  const priorityOrderId = (await fairRowFor(priorityChat)).orderId;

  const oldWebsiteIds = Array.from({ length: 6 }, (_, i) => `TEST_OLD_WEBSITE_${i + 1}`);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  for (const id of oldWebsiteIds) await seedWebsiteOrder(id, weekAgo);

  try {
    const priorityTick = await runStudioPipelineTick();
    console.log("priority tick:", priorityTick.detail.slice(0, 500));

    const priorityRuns = await stepRunsFor(priorityOrderId);
    const ranDog = priorityRuns.some((r) => r.stepKey.startsWith("DOG_") && r.status === "success");
    const ranText = priorityRuns.some((r) => r.stepKey.startsWith("TEXT_") && r.status === "success");
    if (!ranDog || !ranText) {
      throw new Error(
        `priority failed: fair order did not advance both stages in one tick despite 6 older queued orders (dog=${ranDog}, text=${ranText})`,
      );
    }
    console.log("priority OK: fair order's dog+text lanes both ran in the same tick, ahead of 6 older website orders");
  } finally {
    for (const id of oldWebsiteIds) await removeOrder(id);
    await removeFairClient(priorityChat);
  }

  await cleanup();
  console.log("\nFAIR PARALLEL E2E TEST PASSED ✅");
}

main().then(
  () => process.exit(0),
  async (e) => {
    console.error("FAIR PARALLEL E2E TEST FAILED ❌", e);
    await cleanup().catch(() => {});
    process.exit(1);
  },
);
