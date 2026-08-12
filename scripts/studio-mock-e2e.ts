/**
 * End-to-end pipeline test in mock mode (no network, no real models).
 * Drives the seeded STUDIO-DEMO-1 order through dog → text → final with
 * simulated Telegram approvals and one guided rejection.
 *
 *   npx tsx --conditions react-server scripts/studio-mock-e2e.ts
 *
 * Prereq: npm run studio:db:push (or the migrate script) + npm run studio:seed
 */
process.env.STUDIO_MOCK_AI = "true";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import {
  handleTelegramCallback,
  handleTelegramCommand,
} from "../lib/studio/telegram/review-bot";

const SHEET_ID = "STUDIO-DEMO-1";

async function orderStatus(): Promise<string> {
  const db = getStudioDb();
  const [o] = await db
    .select({ status: schema.studioOrders.status, lastError: schema.studioOrders.lastError })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, SHEET_ID))
    .limit(1);
  if (!o) throw new Error("demo order missing — run npm run studio:seed");
  return o.status;
}

async function tickUntil(target: string, label: string, maxTicks = 10): Promise<void> {
  for (let i = 1; i <= maxTicks; i++) {
    const r = await runStudioPipelineTick();
    const st = await orderStatus();
    console.log(`[${label}] tick ${i}: status=${st}\n    ${r.detail}`);
    if (st === target) return;
  }
  throw new Error(`[${label}] did not reach ${target} in ${maxTicks} ticks (now: ${await orderStatus()})`);
}

async function resetDemoOrder(): Promise<void> {
  const db = getStudioDb();
  const [o] = await db
    .select({ id: schema.studioOrders.id })
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, SHEET_ID))
    .limit(1);
  if (!o) throw new Error("demo order missing — run npm run studio:seed");
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, o.id));
  await db
    .update(schema.studioOrders)
    .set({
      status: "assets_loaded",
      lastError: "",
      approvedDogArtifactPath: "",
      approvedTextArtifactPath: "",
      approvedFinalArtifactPath: "",
      reviewNotifiedFor: "",
      humanRejectNote: "",
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, o.id));
}

async function main() {
  await resetDemoOrder();
  console.log("start status:", await orderStatus());

  // Lock check: two concurrent ticks — one must be skipped or both must
  // complete without duplicating steps (SQLite serializes same-process writes).
  const [a, b] = await Promise.all([runStudioPipelineTick(), runStudioPipelineTick()]);
  console.log("concurrent tick A:", a.detail.slice(0, 100));
  console.log("concurrent tick B:", b.detail.slice(0, 100));

  await tickUntil("dog_awaiting_approval", "dog stage");

  // Guided rejection: note must flow through the prompt-writer and regenerate
  console.log(await handleTelegramCommand(`/reject_dog_${SHEET_ID} ears too big, make them floppy`));
  await tickUntil("dog_awaiting_approval", "dog correction");

  // Button approve
  console.log(await handleTelegramCallback(`a|dog|${SHEET_ID}`));
  console.log("after dog approve:", await orderStatus());

  await tickUntil("text_awaiting_approval", "text stage");
  console.log(await handleTelegramCallback(`a|text|${SHEET_ID}`));
  console.log("after text approve:", await orderStatus());

  await tickUntil("final_awaiting_approval", "final stage");
  console.log(await handleTelegramCallback(`a|final|${SHEET_ID}`));
  console.log("after final approve:", await orderStatus());

  // Count artifacts + step runs for the demo order
  const db = getStudioDb();
  const [o] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, SHEET_ID))
    .limit(1);
  const runs = await db
    .select({ stepKey: schema.studioStepRuns.stepKey, status: schema.studioStepRuns.status })
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, o.id));
  console.log(`\nstep runs (${runs.length}):`);
  for (const r of runs) console.log(`  ${r.status.padEnd(8)} ${r.stepKey}`);
  console.log("\nE2E MOCK TEST PASSED ✅  final status:", o.status);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("E2E MOCK TEST FAILED ❌", e);
    process.exit(1);
  },
);
