/**
 * End-to-end dry run of the fair-event flow in mock mode: no real network
 * calls to Telegram (client or owner bot), YooKassa, or Google Sheets — all
 * gated behind STUDIO_MOCK_AI (see mock branches in client-bot.ts,
 * download-photo.ts, lib/payments/yookassa.ts, fair-flow.ts). Drive uploads
 * during approve steps DO still go out for real if GOOGLE_* env is
 * configured — same as the existing studio-mock-e2e.ts.
 *
 * Also covers the FIX-1..FIX-6 regression fixes from docs/FAIR-BOT-FIX-PROMPT.md:
 * FIX-1 (final reject regenerates), FIX-3 (a second pending ❌ auto-resolves
 * the first instead of clobbering it), FIX-4 (/start before any photo claims
 * no session; /start mid-intake just reminds), FIX-5 (/fair lists active
 * orders).
 *
 *   npx tsx --conditions react-server scripts/fair-mock-e2e.ts
 */
process.env.STUDIO_MOCK_AI = "true";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "../lib/studio/db";
import { ensureStudioSchema } from "../lib/studio/db/ensure-schema";
import { __mockMarkPaymentSucceeded } from "../lib/payments/yookassa";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";
import {
  handleFairCallback,
  handleFairCommand,
  handleFairPhoto,
  handleFairText,
  listActiveFairOrders,
} from "../lib/studio/telegram/fair-flow";
import {
  handlePendingReviewComment,
  handleTelegramCallback,
  handleTelegramCommand,
} from "../lib/studio/telegram/review-bot";

const CHAT_ID = "555000111";
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim() || "0";

async function fairRow() {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, CHAT_ID));
  if (!rows.length) throw new Error("fair session missing");
  return rows[rows.length - 1];
}

async function countFairRows(): Promise<number> {
  const db = getStudioDb();
  const rows = await db
    .select({ id: schema.studioFairOrders.id })
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, CHAT_ID));
  return rows.length;
}

async function orderRow(orderId: string) {
  const db = getStudioDb();
  const [o] = await db.select().from(schema.studioOrders).where(eq(schema.studioOrders.id, orderId)).limit(1);
  if (!o) throw new Error("order missing");
  return o;
}

async function tickUntil(
  predicate: () => Promise<boolean>,
  label: string,
  maxTicks = 15,
): Promise<void> {
  for (let i = 1; i <= maxTicks; i++) {
    const r = await runStudioPipelineTick();
    console.log(`[${label}] tick ${i}: ${r.detail}`);
    if (await predicate()) return;
  }
  throw new Error(`[${label}] condition not met in ${maxTicks} ticks`);
}

/** Captures console.log output produced while `fn` runs (used to inspect mock-mode "sent to client" lines). */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = orig;
  }
}

async function resetPriorRuns(): Promise<void> {
  const db = getStudioDb();
  const prior = await db
    .select({ id: schema.studioFairOrders.id, orderId: schema.studioFairOrders.orderId })
    .from(schema.studioFairOrders)
    .where(eq(schema.studioFairOrders.chatId, CHAT_ID));
  for (const p of prior) {
    await db.delete(schema.studioFairOrders).where(eq(schema.studioFairOrders.id, p.id));
    await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.orderId, p.orderId));
    await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, p.orderId));
    await db.delete(schema.studioOrders).where(eq(schema.studioOrders.id, p.orderId));
  }
}

async function main() {
  await ensureStudioSchema();
  await resetPriorRuns();

  // --- FIX-4a: a bare /start with no photo yet must NOT claim a session
  // (the free-mockup slot is only spent once a photo actually arrives).
  const startedBeforePhoto = await handleFairCommand(CHAT_ID, "/start");
  if (!startedBeforePhoto.handled) throw new Error("/start not handled");
  if ((await countFairRows()) !== 0) {
    throw new Error("FIX-4a failed: /start created a session before any photo was sent");
  }
  console.log("FIX-4a OK: /start alone claims no session");

  // 1. Intake: photo (this is what actually creates the session) -> pet name -> email
  const photo = await handleFairPhoto(CHAT_ID, "mock-file-1");
  if (!photo.handled) throw new Error("photo not handled");
  if ((await countFairRows()) !== 1) throw new Error("photo did not create exactly one session");

  let fair = await fairRow();
  if (fair.step !== "awaiting_pet_name") throw new Error(`expected awaiting_pet_name, got ${fair.step}`);

  // --- FIX-4b: /start mid-intake (mockup not delivered yet) must continue
  // with a reminder, not the "one free mockup" decline.
  const { logs: midIntakeLogs } = await captureLogs(() => handleFairCommand(CHAT_ID, "/start"));
  const midIntakeText = midIntakeLogs.join(" | ");
  if (midIntakeText.includes("бесплатный макет доступен один раз")) {
    throw new Error(`FIX-4b failed: /start mid-intake declined instead of reminding: ${midIntakeText}`);
  }
  if (!midIntakeText.includes("кличку")) {
    throw new Error(`FIX-4b failed: expected a pet-name reminder, got: ${midIntakeText}`);
  }
  if ((await countFairRows()) !== 1) throw new Error("FIX-4b failed: repeat /start created a second session");
  console.log("FIX-4b OK: /start mid-intake reminds instead of declining");

  const petNameResult = await handleFairText(CHAT_ID, "Дружок");
  if (!petNameResult.handled) throw new Error("pet name not handled");

  const emailResult = await handleFairText(CHAT_ID, "test@example.com");
  if (!emailResult.handled || !emailResult.triggerTick) throw new Error("email step should trigger a tick");

  fair = await fairRow();
  if (fair.step !== "generating") throw new Error(`expected generating, got ${fair.step}`);
  console.log("intake OK: order", fair.orderId, "step", fair.step);

  // 2. Generation: fair mode skips auto-critique, so one image each is enough.
  await tickUntil(async () => {
    const o = await orderRow(fair.orderId);
    return o.dogStatus === "awaiting_approval" && o.textStatus === "awaiting_approval";
  }, "dog+text generation");

  const genOrder = await orderRow(fair.orderId);
  console.log("generation OK: sheetOrderId", genOrder.sheetOrderId);

  // --- FIX-5: /fair lists this order while it's still active.
  const activeViaHelper = await listActiveFairOrders(20);
  if (!activeViaHelper.some((r) => r.sheetOrderId === genOrder.sheetOrderId)) {
    throw new Error("FIX-5 failed: listActiveFairOrders did not include the active order");
  }
  const fairCommandReply = await handleTelegramCommand("/fair");
  if (!fairCommandReply.includes(genOrder.sheetOrderId)) {
    throw new Error(`FIX-5 failed: /fair reply missing active order: ${fairCommandReply}`);
  }
  console.log("FIX-5 OK: /fair lists the active order");

  // --- FIX-3: pressing ❌ on a SECOND stage while a comment is still pending
  // on the first must auto-resolve the first (without a comment) instead of
  // silently losing it, then track the comment for the second correctly.
  const rejectDogPrompt = await handleTelegramCallback(`r|dog|${genOrder.sheetOrderId}`, OWNER_CHAT_ID);
  if (rejectDogPrompt !== "") throw new Error(`expected empty ack (comment prompt sent), got: ${rejectDogPrompt}`);

  const rejectTextPrompt = await handleTelegramCallback(`r|text|${genOrder.sheetOrderId}`, OWNER_CHAT_ID);
  if (rejectTextPrompt !== "") throw new Error(`expected empty ack (comment prompt sent), got: ${rejectTextPrompt}`);

  const afterAutoResolve = await orderRow(fair.orderId);
  if (afterAutoResolve.dogStatus !== "in_progress") {
    throw new Error("FIX-3 failed: pressing ❌ on text did not auto-resolve the pending dog reject");
  }
  if (!afterAutoResolve.humanRejectNote?.trim()) {
    throw new Error("FIX-3 failed: dog reject was not applied with a note (generic fallback expected)");
  }
  const dogRejectRuns = await getStudioDb()
    .select({ stepKey: schema.studioStepRuns.stepKey })
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, fair.orderId));
  if (!dogRejectRuns.some((r) => r.stepKey === "HUMAN_REJECT_DOG")) {
    throw new Error("FIX-3 failed: no HUMAN_REJECT_DOG audit row after auto-resolve");
  }

  const textCommentResult = await handlePendingReviewComment(OWNER_CHAT_ID, "хвост должен быть подлиннее");
  if (!textCommentResult.handled) throw new Error("FIX-3 failed: text comment not consumed");
  const afterTextReject = await orderRow(fair.orderId);
  if (afterTextReject.textStatus !== "in_progress") throw new Error("FIX-3 failed: text reject did not requeue textStatus");
  if (afterTextReject.textRejectNote !== "хвост должен быть подлиннее") {
    throw new Error(`FIX-3 failed: text reject note lost: ${JSON.stringify(afterTextReject.textRejectNote)}`);
  }
  console.log("FIX-3 OK: second ❌ auto-resolved the first pending reject, then tracked its own comment");

  await tickUntil(async () => {
    const o = await orderRow(fair.orderId);
    return o.dogStatus === "awaiting_approval" && o.textStatus === "awaiting_approval";
  }, "dog+text correction after FIX-3 sequence");

  // 4. Approve both stages -> auto-starts final composition
  console.log(await handleTelegramCallback(`a|text|${genOrder.sheetOrderId}`));
  console.log(await handleTelegramCallback(`a|dog|${genOrder.sheetOrderId}`));
  const afterBoth = await orderRow(fair.orderId);
  if (afterBoth.status !== "final_in_progress") {
    throw new Error(`expected final_in_progress, got ${afterBoth.status}`);
  }

  await tickUntil(async () => {
    const o = await orderRow(fair.orderId);
    return o.status === "final_awaiting_approval";
  }, "final composition");

  // --- FIX-1: rejecting the final mockup with a comment must actually
  // regenerate it (not just bounce straight back to awaiting_approval with
  // the same artifact, which is what skipsAutoCritique used to do).
  const firstFinalRun = await getStudioDb()
    .select({ path: schema.studioStepRuns.outputArtifactPath })
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, fair.orderId))
    .then((rows) => rows.filter((r) => r.path).at(-1));
  const firstFinalArtifact = firstFinalRun?.path ?? "";
  if (!firstFinalArtifact) throw new Error("FIX-1 setup failed: no final artifact to compare against");

  const rejectFinalPrompt = await handleTelegramCallback(`r|final|${genOrder.sheetOrderId}`, OWNER_CHAT_ID);
  if (rejectFinalPrompt !== "") throw new Error(`expected empty ack (comment prompt sent), got: ${rejectFinalPrompt}`);
  const finalCommentResult = await handlePendingReviewComment(OWNER_CHAT_ID, "звёздочки съехали, поправь");
  if (!finalCommentResult.handled) throw new Error("FIX-1 failed: final comment not consumed");

  const afterFinalReject = await orderRow(fair.orderId);
  if (afterFinalReject.status !== "final_in_progress") {
    throw new Error(`FIX-1 failed: expected final_in_progress after reject, got ${afterFinalReject.status}`);
  }
  if (afterFinalReject.humanRejectNote !== "звёздочки съехали, поправь") {
    throw new Error(`FIX-1 failed: final reject note lost: ${JSON.stringify(afterFinalReject.humanRejectNote)}`);
  }

  await tickUntil(async () => {
    const o = await orderRow(fair.orderId);
    return o.status === "final_awaiting_approval";
  }, "final regeneration after reject");

  const afterCorrection = await orderRow(fair.orderId);
  if (afterCorrection.humanRejectNote?.trim()) {
    throw new Error("FIX-1 failed: humanRejectNote was not cleared after the correction ran");
  }
  const finalCorrectionRuns = await getStudioDb()
    .select({ stepKey: schema.studioStepRuns.stepKey, status: schema.studioStepRuns.status, path: schema.studioStepRuns.outputArtifactPath })
    .from(schema.studioStepRuns)
    .where(eq(schema.studioStepRuns.orderId, fair.orderId));
  const correctionRun = finalCorrectionRuns.find(
    (r) => r.stepKey === "FINAL_IMG_V2_CORRECTION" && r.status === "success",
  );
  if (!correctionRun) throw new Error("FIX-1 failed: no successful FINAL_IMG_V2_CORRECTION after reject");
  if (correctionRun.path === firstFinalArtifact) {
    throw new Error("FIX-1 failed: final correction produced the SAME artifact as before the reject");
  }
  console.log("FIX-1 OK: final reject regenerated a new artifact and cleared the note");

  // 5. Approve final -> hands mockup + mock payment link to the client bot
  console.log(await handleTelegramCallback(`a|final|${genOrder.sheetOrderId}`));
  fair = await fairRow();
  if (fair.step !== "awaiting_payment") throw new Error(`expected awaiting_payment, got ${fair.step}`);
  if (!fair.paymentId) throw new Error("no mock payment id recorded");
  console.log("final approve OK: payment", fair.paymentId, "makeupUrl", fair.makeupUrl || "(none)");

  // 6. Simulate YooKassa notifying success (poll-fallback path, since we did
  // not also hit the real webhook route in this dry run).
  __mockMarkPaymentSucceeded(fair.paymentId);
  await tickUntil(async () => (await fairRow()).step === "paid_awaiting_size", "payment poll confirmation");
  console.log("payment confirmation OK");

  // 6b. Fiscal receipt («Мой налог» mock) must have been registered exactly
  // once as part of the payment-success handling.
  fair = await fairRow();
  if (fair.receiptStatus !== "sent") throw new Error(`expected receiptStatus=sent, got "${fair.receiptStatus}"`);
  if (!fair.receiptUrl.includes("/receipt/")) throw new Error(`unexpected receiptUrl: "${fair.receiptUrl}"`);
  console.log("moy-nalog receipt OK:", fair.receiptUrl);

  // 7. Post-payment questionnaire
  const sizeResult = await handleFairCallback(CHAT_ID, "fs:M");
  if (!sizeResult.handled) throw new Error("size callback not handled");
  await handleFairText(CHAT_ID, "Иванов Иван Иванович");
  await handleFairText(CHAT_ID, "+7 900 123-45-67");
  const deliveryResult = await handleFairCallback(CHAT_ID, "fd:cdek");
  if (!deliveryResult.handled) throw new Error("delivery callback not handled");
  await handleFairText(CHAT_ID, "Москва, ул. Тестовая, 1");

  fair = await fairRow();
  if (fair.step !== "done") throw new Error(`expected done, got ${fair.step}`);
  if (!fair.sheetRowWritten) throw new Error("sheet row was not marked written");
  if (fair.size !== "M" || fair.fio !== "Иванов Иван Иванович" || fair.deliveryService !== "cdek") {
    throw new Error(`questionnaire fields incomplete: ${JSON.stringify(fair)}`);
  }
  console.log("questionnaire + sheet write OK:", JSON.stringify({
    size: fair.size,
    fio: fair.fio,
    phone: fair.phone,
    delivery: fair.deliveryService,
    pvz: fair.pvz,
  }));

  // --- FIX-5b: a completed order must drop out of the active list.
  const activeAfterDone = await listActiveFairOrders(20);
  if (activeAfterDone.some((r) => r.sheetOrderId === genOrder.sheetOrderId)) {
    throw new Error("FIX-5 failed: a done order still shows up as active");
  }

  // 8. One-mockup-per-account limit: a second /start must not create a new session.
  const before = await countFairRows();
  await handleFairCommand(CHAT_ID, "/start");
  const after = await countFairRows();
  if (after !== before) throw new Error("second /start created a new session — limit not enforced");
  console.log("one-mockup-per-account limit OK");

  console.log("\nFAIR E2E MOCK TEST PASSED ✅");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FAIR E2E MOCK TEST FAILED ❌", e);
    process.exit(1);
  },
);
