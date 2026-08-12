/**
 * Live-mode driver for the Studio pipeline (real Google + OpenRouter + Telegram).
 * Loads .env.local into process.env first (plain scripts don't get Next's env).
 *
 *   npx tsx --conditions react-server scripts/studio-live.ts templates
 *   npx tsx --conditions react-server scripts/studio-live.ts orders
 *   npx tsx --conditions react-server scripts/studio-live.ts park-all-except <SHEET_ORDER_ID>
 *   npx tsx --conditions react-server scripts/studio-live.ts tick
 *   npx tsx --conditions react-server scripts/studio-live.ts status
 *   npx tsx --conditions react-server scripts/studio-live.ts approve|reject <dog|text|final> <SHEET_ORDER_ID> [comment]
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  const raw = fs.readFileSync(p, "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const [cmd, ...args] = process.argv.slice(2);

  const { getStudioDb, schema } = await import("../lib/studio/db");
  const { eq, ne } = await import("drizzle-orm");

  if (cmd === "tabs") {
    const { getGoogleOpsClients } = await import("../lib/ops/google-client");
    const clients = getGoogleOpsClients();
    if (!clients) throw new Error("google not configured");
    const meta = await clients.sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID!.trim(),
      fields: "sheets(properties(title))",
    });
    console.log("tabs:", meta.data.sheets?.map((s) => s.properties?.title));
    return;
  }

  if (cmd === "headers") {
    const { fetchOrderSheetGrid } = await import("../lib/ops/sheet-repository");
    const grid = await fetchOrderSheetGrid();
    if (!grid) throw new Error("sheet not configured");
    console.log("headers:", JSON.stringify(grid.headers));
    console.log("rows:", grid.rows.length);
    for (const r of grid.rows.slice(-8)) {
      const v = r.values;
      console.log(
        `row ${r.rowNumber}: id=${v["Order ID"]} pet=${v["Кличка"]} style=${v["Стиль"]} photo=${JSON.stringify(v["Ссылка на фото"])} n=${v["Количество фото"]} print=${JSON.stringify((v["Ссылка на принт"] || "").slice(0, 40))}`,
      );
    }
    return;
  }

  if (cmd === "templates") {
    const { syncStudioTemplatesFromDrive } = await import(
      "../lib/studio/google/sync-templates-from-drive"
    );
    console.log(await syncStudioTemplatesFromDrive());
    return;
  }

  if (cmd === "orders") {
    const { syncStudioOrdersFromGoogleSheet } = await import(
      "../lib/studio/google/sync-orders-from-sheet"
    );
    console.log(await syncStudioOrdersFromGoogleSheet());
    const db = getStudioDb();
    const rows = await db.select().from(schema.studioOrders);
    for (const o of rows) {
      console.log(
        `${o.sheetOrderId.padEnd(18)} status=${o.status.padEnd(22)} style=${o.designSlug.padEnd(6)} pet=${o.petNameRaw.padEnd(14)} photos_folder=${o.driveFolderId ? "yes" : "NO"}`,
      );
    }
    return;
  }

  if (cmd === "park-all-except") {
    const keep = args[0];
    if (!keep) throw new Error("usage: park-all-except <SHEET_ORDER_ID>");
    const db = getStudioDb();
    const r = await db
      .update(schema.studioOrders)
      .set({ status: "completed", updatedAt: new Date() })
      .where(ne(schema.studioOrders.sheetOrderId, keep));
    console.log(`parked ${r.rowsAffected} orders as completed; kept ${keep}`);
    return;
  }

  if (cmd === "unpark") {
    const sheetId = args[0];
    if (!sheetId) throw new Error("usage: unpark <SHEET_ORDER_ID>");
    const r = await getStudioDb()
      .update(schema.studioOrders)
      .set({ status: "new", lastError: "", retryCount: 0, nextRetryAt: null, updatedAt: new Date() })
      .where(eq(schema.studioOrders.sheetOrderId, sheetId));
    console.log(`unparked ${sheetId}: ${r.rowsAffected}`);
    return;
  }

  if (cmd === "reupload") {
    const sheetId = args[0];
    if (!sheetId) throw new Error("usage: reupload <SHEET_ORDER_ID>");
    const db = getStudioDb();
    const [o] = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetId))
      .limit(1);
    if (!o) throw new Error("order not found");
    const { uploadStudioArtifactToFolder } = await import(
      "../lib/studio/google/upload-artifact"
    );
    const jobs: { path: string; folderKey: "approved" | "textBadges"; suffix?: string }[] = [];
    if (o.approvedDogArtifactPath) jobs.push({ path: o.approvedDogArtifactPath, folderKey: "approved" });
    if (o.approvedTextArtifactPath) jobs.push({ path: o.approvedTextArtifactPath, folderKey: "textBadges" });
    if (o.approvedFinalArtifactPath) jobs.push({ path: o.approvedFinalArtifactPath, folderKey: "approved", suffix: "_final" });
    for (const j of jobs) {
      const r = await uploadStudioArtifactToFolder({
        studioRelativePath: j.path,
        folderKey: j.folderKey,
        fileBaseName: j.suffix ? `${o.petNameRaw}${j.suffix}` : o.petNameRaw,
      });
      console.log(j.folderKey, r.ok ? `OK → ${r.fileName} (${r.fileId})` : `FAIL: ${r.error}`);
    }
    return;
  }

  if (cmd === "seed-prompts") {
    const { STUDIO_DEFAULT_PROMPTS } = await import("../lib/studio/prompt-defaults");
    const db = getStudioDb();
    for (const p of STUDIO_DEFAULT_PROMPTS) {
      await db
        .insert(schema.studioPromptDefinitions)
        .values({ key: p.key, title: p.title, body: p.body })
        .onConflictDoUpdate({
          target: schema.studioPromptDefinitions.key,
          set: { title: p.title, body: p.body, updatedAt: new Date() },
        });
    }
    console.log(`upserted ${STUDIO_DEFAULT_PROMPTS.length} prompt definitions`);
    return;
  }

  if (cmd === "reset-text") {
    const sheetId = args[0];
    if (!sheetId) throw new Error("usage: reset-text <SHEET_ORDER_ID>");
    const db = getStudioDb();
    const [o] = await db
      .select()
      .from(schema.studioOrders)
      .where(eq(schema.studioOrders.sheetOrderId, sheetId))
      .limit(1);
    if (!o) throw new Error("order not found");
    const runs = await db
      .select({ id: schema.studioStepRuns.id, stepKey: schema.studioStepRuns.stepKey })
      .from(schema.studioStepRuns)
      .where(eq(schema.studioStepRuns.orderId, o.id));
    for (const r of runs) {
      if (r.stepKey.startsWith("TEXT_")) {
        await db.delete(schema.studioStepRuns).where(eq(schema.studioStepRuns.id, r.id));
      }
    }
    await db
      .update(schema.studioOrders)
      .set({
        status: "dog_approved_idle",
        approvedTextArtifactPath: "",
        reviewNotifiedFor: "",
        humanRejectNote: "",
        lastError: "",
        retryCount: 0,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, o.id));
    console.log(`reset text stage for ${sheetId} → dog_approved_idle (text runs wiped)`);
    return;
  }

  if (cmd === "costs") {
    const db = getStudioDb();
    const calls = await db.select().from(schema.studioAiCalls);
    if (!calls.length) {
      console.log("no AI calls recorded yet");
      return;
    }
    const byOrder = new Map<string, { cost: number; tokens: number; n: number; img: number }>();
    for (const c of calls) {
      const cur = byOrder.get(c.orderId) ?? { cost: 0, tokens: 0, n: 0, img: 0 };
      cur.cost += c.costUsd;
      cur.tokens += c.totalTokens;
      cur.n += 1;
      if (c.kind === "image") cur.img += 1;
      byOrder.set(c.orderId, cur);
    }
    const orders = await db.select().from(schema.studioOrders);
    const nameById = new Map(orders.map((o) => [o.id, `${o.sheetOrderId} (${o.petNameRaw})`]));
    let totalCost = 0;
    console.log("Per order:");
    for (const [oid, v] of byOrder) {
      totalCost += v.cost;
      console.log(
        `  ${(nameById.get(oid) ?? oid).padEnd(34)} $${v.cost.toFixed(4)}  |  ${v.tokens} tok  |  ${v.n} calls (${v.img} img)`,
      );
    }
    const avg = totalCost / byOrder.size;
    console.log(`\nOrders with cost: ${byOrder.size}`);
    console.log(`Total: $${totalCost.toFixed(4)}`);
    console.log(`Average per order: $${avg.toFixed(4)}`);
    return;
  }

  if (cmd === "tick") {
    const { runStudioPipelineTick } = await import("../lib/studio/pipeline/orchestrator");
    console.log(await runStudioPipelineTick());
    return;
  }

  if (cmd === "status") {
    const db = getStudioDb();
    const rows = await db.select().from(schema.studioOrders);
    for (const o of rows) {
      if (o.status === "completed") continue;
      console.log(
        `${o.sheetOrderId.padEnd(18)} status=${o.status.padEnd(22)} retry=${o.retryCount} lastError=${(o.lastError || "").slice(0, 120)}`,
      );
    }
    const runs = await db
      .select({
        stepKey: schema.studioStepRuns.stepKey,
        status: schema.studioStepRuns.status,
        orderId: schema.studioStepRuns.orderId,
        artifact: schema.studioStepRuns.outputArtifactPath,
        error: schema.studioStepRuns.error,
      })
      .from(schema.studioStepRuns);
    console.log(`\nstep runs: ${runs.length}`);
    for (const r of runs.slice(-15)) {
      console.log(
        `  ${r.status.padEnd(8)} ${r.stepKey.padEnd(24)} ${r.artifact || r.error.slice(0, 80)}`,
      );
    }
    return;
  }

  if (cmd === "approve" || cmd === "reject") {
    const [stage, sheetId, ...noteParts] = args;
    if (!stage || !sheetId) throw new Error("usage: approve|reject <dog|text|final> <SHEET_ORDER_ID> [comment]");
    const { handleTelegramCommand } = await import("../lib/studio/telegram/review-bot");
    const note = noteParts.join(" ");
    const text =
      cmd === "approve"
        ? `/approve_${stage}_${sheetId}`
        : `/reject_${stage}_${sheetId} ${note}`.trim();
    console.log(await handleTelegramCommand(text));
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
