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

import { and, eq, inArray } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import { ensureStudioSchema } from "../lib/studio/db/ensure-schema";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import { handleFairPhoto, handleFairText } from "../lib/studio/telegram/fair-flow";

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
