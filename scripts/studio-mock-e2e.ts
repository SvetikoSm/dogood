/**
 * End-to-end pipeline test in mock mode (no network, no real models).
 * Drives the seeded STUDIO-DEMO-1 order (mode="full") through dog + text
 * (now generated concurrently, independent of each other) → final, with
 * simulated Telegram approvals and guided rejections on both stages.
 *
 *   npx tsx --conditions react-server scripts/studio-mock-e2e.ts
 *
 * Prereq: npm run studio:db:push (or the migrate script) + npm run studio:seed
 */
process.env.STUDIO_MOCK_AI = "true";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import { ensureStudioSchema } from "../lib/studio/db/ensure-schema";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import {
  handleTelegramCallback,
  handleTelegramCommand,
} from "../lib/studio/telegram/review-bot";

const SHEET_ID = "STUDIO-DEMO-1";

async function orderRow() {
  const db = getStudioDb();
  const [o] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, SHEET_ID))
    .limit(1);
  if (!o) throw new Error("demo order missing — run npm run studio:seed");
  return o;
}

async function tickUntil(
  predicate: (o: Awaited<ReturnType<typeof orderRow>>) => boolean,
  label: string,
  maxTicks = 10,
): Promise<void> {
  for (let i = 1; i <= maxTicks; i++) {
    const r = await runStudioPipelineTick();
    const o = await orderRow();
    console.log(
      `[${label}] tick ${i}: status=${o.status} dog=${o.dogStatus} text=${o.textStatus}\n    ${r.detail}`,
    );
    if (predicate(o)) return;
  }
  const o = await orderRow();
  throw new Error(
    `[${label}] condition not met in ${maxTicks} ticks (now: status=${o.status} dog=${o.dogStatus} text=${o.textStatus})`,
  );
}

async function resetDemoOrder(): Promise<void> {
  const db = getStudioDb();
  const o = await orderRow();
  await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, o.id));
  await db
    .update(schema.studioOrders)
    .set({
      status: "assets_loaded",
      dogStatus: "pending",
      textStatus: "pending",
      dogNotified: false,
      textNotified: false,
      lastError: "",
      approvedDogArtifactPath: "",
      approvedTextArtifactPath: "",
      approvedFinalArtifactPath: "",
      reviewNotifiedFor: "",
      humanRejectNote: "",
      textRejectNote: "",
      retryCount: 0,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.studioOrders.id, o.id));
}

async function main() {
  await ensureStudioSchema();
  await resetDemoOrder();
  const start = await orderRow();
  console.log("start:", `status=${start.status} dog=${start.dogStatus} text=${start.textStatus}`);

  // Lock check: two concurrent ticks — one must be skipped or both must
  // complete without duplicating steps (SQLite serializes same-process writes).
  const [a, b] = await Promise.all([runStudioPipelineTick(), runStudioPipelineTick()]);
  console.log("concurrent tick A:", a.detail.slice(0, 100));
  console.log("concurrent tick B:", b.detail.slice(0, 100));

  // Core proof of concurrency: both stages must reach awaiting_approval
  // WITHOUT any human approval in between. Under the old sequential design
  // this was impossible — text steps refused to run until the dog was
  // human-approved, so this loop would stall on "Approve dog stage first"
  // errors instead of converging.
  await tickUntil(
    (o) => o.dogStatus === "awaiting_approval" && o.textStatus === "awaiting_approval",
    "concurrent dog+text generation",
  );

  // Reject BOTH stages back-to-back, before either correction has run, to
  // prove the dedicated textRejectNote column keeps the two notes from
  // clobbering each other (they used to share one humanRejectNote field).
  console.log(await handleTelegramCommand(`/reject_dog_${SHEET_ID} ears too big, make them floppy`));
  console.log(await handleTelegramCommand(`/reject_text_${SHEET_ID} make the color darker red`));
  const afterBothRejects = await orderRow();
  if (afterBothRejects.humanRejectNote !== "ears too big, make them floppy") {
    throw new Error(`dog reject note lost/clobbered: ${JSON.stringify(afterBothRejects.humanRejectNote)}`);
  }
  if (afterBothRejects.textRejectNote !== "make the color darker red") {
    throw new Error(`text reject note lost/clobbered: ${JSON.stringify(afterBothRejects.textRejectNote)}`);
  }
  console.log("reject-note isolation OK: dog and text notes both survived intact");

  await tickUntil(
    (o) => o.dogStatus === "awaiting_approval" && o.textStatus === "awaiting_approval",
    "dog+text correction after concurrent reject",
  );

  // Approve TEXT first (before dog) to prove completion works regardless of
  // which stage finishes second.
  console.log(await handleTelegramCallback(`a|text|${SHEET_ID}`));
  const afterTextApprove = await orderRow();
  console.log("after text approve:", `status=${afterTextApprove.status} dog=${afterTextApprove.dogStatus} text=${afterTextApprove.textStatus}`);
  if (afterTextApprove.status === "final_in_progress" || afterTextApprove.status === "completed") {
    throw new Error("order advanced to final/completed before dog was approved — maybeCompleteFullOrder bug");
  }

  console.log(await handleTelegramCallback(`a|dog|${SHEET_ID}`));
  const afterDogApprove = await orderRow();
  console.log("after dog approve:", `status=${afterDogApprove.status} dog=${afterDogApprove.dogStatus} text=${afterDogApprove.textStatus}`);
  if (afterDogApprove.status !== "final_in_progress") {
    throw new Error(`expected final_in_progress once both approved, got ${afterDogApprove.status}`);
  }

  await tickUntil((o) => o.status === "final_awaiting_approval", "final stage");
  console.log(await handleTelegramCallback(`a|final|${SHEET_ID}`));
  const afterFinal = await orderRow();
  console.log("after final approve:", afterFinal.status);
  if (afterFinal.status !== "completed") {
    throw new Error(`expected completed, got ${afterFinal.status}`);
  }

  // Count artifacts + step runs for the demo order
  const db = getStudioDb();
  const runs = await db
    .select({ stepKey: schema.studioStepRuns.stepKey, status: schema.studioStepRuns.status })
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, afterFinal.id));
  console.log(`\nstep runs (${runs.length}):`);
  for (const r of runs) console.log(`  ${r.status.padEnd(8)} ${r.stepKey}`);
  console.log("\nE2E MOCK TEST PASSED ✅  final status:", afterFinal.status);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("E2E MOCK TEST FAILED ❌", e);
    process.exit(1);
  },
);
