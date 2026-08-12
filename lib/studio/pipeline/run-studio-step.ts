import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { openRouterChatJsonTracked } from "@/lib/studio/ai/openrouter-llm";
import { generateStudioImageTracked } from "@/lib/studio/ai/image-generation";
import { getStudioDb, schema } from "@/lib/studio/db";
import { getStudioLlmModel, getStudioImageModel } from "@/lib/studio/env";
import { fetchDrivePhotosForOrder } from "@/lib/studio/google/fetch-order-photos";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";
import { loadPromptBody } from "@/lib/studio/prompts/load-prompt";
import { latestSuccessfulStepRun } from "@/lib/studio/pipeline/step-queries";
import { resolveTemplateForSlug } from "@/lib/studio/templates/resolve";
import { STUDIO_PROMPT_KEYS, STUDIO_STEP_KEYS, type StudioStepKey } from "@/lib/studio/step-keys";
import { parseLlmReviewEnvelope } from "@/lib/studio/types/llm-json";
import type { LlmReviewEnvelope } from "@/lib/studio/types/llm-json";

async function nextAttempt(orderId: string, stepKey: string): Promise<number> {
  const db = getStudioDb();
  const [r] = await db
    .select({ n: sql<number>`count(1)`.mapWith(Number) })
    .from(schema.studioStepRuns)
    .where(
      and(
        eq(schema.studioStepRuns.orderId, orderId),
        eq(schema.studioStepRuns.stepKey, stepKey),
      ),
    );
  return (r?.n ?? 0) + 1;
}

/**
 * Read images as data URLs for LLM vision calls, downscaled to keep the
 * request small (full-size photos made OpenRouter calls flaky and expensive).
 * Falls back to raw bytes if sharp fails on a file.
 */
async function readImageUrls(absPaths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of absPaths) {
    try {
      const buf = await fs.readFile(p);
      try {
        const { default: sharp } = await import("sharp");
        const resized = await sharp(buf)
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        out.push(`data:image/jpeg;base64,${resized.toString("base64")}`);
        continue;
      } catch {
        /* fall through to raw bytes */
      }
      const ext = path.extname(p).toLowerCase();
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".webp"
              ? "image/webp"
              : "image/jpeg";
      out.push(`data:${mime};base64,${buf.toString("base64")}`);
    } catch {
      /* skip missing */
    }
  }
  return out;
}

function envelopeJson(env: LlmReviewEnvelope | null, raw: string): string {
  if (env) return JSON.stringify(env);
  return JSON.stringify({
    status: "needs_correction",
    prompt: "",
    reasoning_summary: "parse_error",
    key_issues: ["Could not parse model JSON"],
    confidence: 0,
    raw_excerpt: raw.slice(0, 4000),
  });
}

async function insertRunStart(
  orderId: string,
  stage: string,
  stepKey: string,
  attempt: number,
  inputSnapshot: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  const db = getStudioDb();
  await db.insert(schema.studioStepRuns).values({
    id,
    orderId,
    stage,
    stepKey,
    attempt,
    status: "running",
    inputSnapshotJson: JSON.stringify(inputSnapshot),
    startedAt: new Date(),
    llmModel: getStudioLlmModel(),
    imageModel: getStudioImageModel(),
  });
  return id;
}

async function finishRun(
  id: string,
  patch: Partial<typeof schema.studioStepRuns.$inferInsert>,
) {
  const db = getStudioDb();
  await db
    .update(schema.studioStepRuns)
    .set({
      ...patch,
      finishedAt: new Date(),
    })
    .where(eq(schema.studioStepRuns.id, id));
}

/**
 * Record the failure on the order WITHOUT changing its status.
 * Retry/backoff and the final "error" transition are the orchestrator's job,
 * so one transient OpenRouter/Drive failure never permanently stalls an order.
 */
async function failOrder(orderId: string, msg: string) {
  const db = getStudioDb();
  await db
    .update(schema.studioOrders)
    .set({ lastError: msg.slice(0, 4000), updatedAt: new Date() })
    .where(eq(schema.studioOrders.id, orderId));
}

async function loadOrderPhotos(orderId: string) {
  const db = getStudioDb();
  return db
    .select()
    .from(schema.studioOrderPhotos)
    .where(eq(schema.studioOrderPhotos.orderId, orderId))
    .orderBy(asc(schema.studioOrderPhotos.sortOrder));
}

async function envelopeFromLatestStep(
  orderId: string,
  stepKeys: string[],
): Promise<LlmReviewEnvelope | null> {
  const row = await latestSuccessfulStepRun(orderId, stepKeys);
  if (!row?.llmOutputJson) return null;
  return parseLlmReviewEnvelope(row.llmOutputJson);
}

/**
 * Execute a single pipeline step for one order (explicit button in UI).
 * Each invocation creates one `studio_step_runs` row.
 */
export async function runStudioStep(
  orderId: string,
  stepKey: StudioStepKey,
): Promise<{ ok: true; stepRunId: string } | { ok: false; error: string }> {
  const db = getStudioDb();
  // Cost-tracked wrappers: every LLM/image call in this step is billed to
  // (orderId, stepKey) in studio_ai_calls.
  const runLlm = (opts: Parameters<typeof openRouterChatJsonTracked>[1]) =>
    openRouterChatJsonTracked({ orderId, stepKey }, opts);
  const runImg = (input: Parameters<typeof generateStudioImageTracked>[1]) =>
    generateStudioImageTracked({ orderId, stepKey }, input);

  const [order] = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.id, orderId))
    .limit(1);
  if (!order) return { ok: false, error: "order not found" };

  const attempt = await nextAttempt(orderId, stepKey);
  const tpl = await resolveTemplateForSlug(order.designSlug);
  if (!tpl && stepKey !== STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS) {
    return {
      ok: false,
      error: `No template row for slug "${order.designSlug}" — run npm run studio:seed`,
    };
  }

  if (stepKey === STUDIO_STEP_KEYS.FETCH_DRIVE_PHOTOS) {
    const snap = { driveFolderId: order.driveFolderId };
    const runId = await insertRunStart(orderId, "ingest", stepKey, attempt, snap);
    const r = await fetchDrivePhotosForOrder(orderId);
    if (!r.ok) {
      await finishRun(runId, { status: "failed", error: r.error });
      await failOrder(orderId, r.error);
      return { ok: false, error: r.error };
    }
    await finishRun(runId, {
      status: "success",
      error: "",
      llmOutputJson: JSON.stringify({ downloaded: r.downloaded, detail: r.detail }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (!tpl) return { ok: false, error: "template missing" };

  /* ---------- Stage A ---------- */
  if (stepKey === STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT) {
    const photos = await loadOrderPhotos(orderId);
    if (!photos.length) {
      return { ok: false, error: "Load pet photos first (Drive fetch step)" };
    }
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const refAbs = [...petAbs, ...tpl.petStyleRefAbs];
    const urls = await readImageUrls(refAbs);
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, {
      refs: refAbs.length,
    });
    await db
      .update(schema.studioOrders)
      .set({ status: "dog_in_progress", lastError: "", updatedAt: new Date() })
      .where(eq(schema.studioOrders.id, orderId));

    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.dog_initial_prompt_llm);
    const user = [
      `Order: ${order.sheetOrderId}`,
      `Pet name (exact Unicode, do not change): ${JSON.stringify(order.petNameRaw)}`,
      `Script hint: ${order.petNameScript}`,
      `Template slug: ${order.designSlug}`,
      `Customer: ${order.customerName}`,
    ].join("\n");

    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error, rawLlmResponseText: "" });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.DOG_IMG_V1) {
    const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.DOG_LLM_INITIAL_PROMPT]);
    const prompt = env?.prompt?.trim();
    if (!prompt) {
      return { ok: false, error: "Run dog prompt LLM step first (no prompt found)" };
    }
    const photos = await loadOrderPhotos(orderId);
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, { promptLen: prompt.length });
    const gen = await runImg({
      prompt,
      referenceImagePaths: [...petAbs, ...tpl.petStyleRefAbs],
    });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE) {
    const imgRow = await latestSuccessfulStepRun(orderId, [
      STUDIO_STEP_KEYS.DOG_IMG_V1,
      STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
      STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY,
    ]);
    if (!imgRow?.outputArtifactPath) {
      return { ok: false, error: "No dog image artifact yet" };
    }
    const photos = await loadOrderPhotos(orderId);
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const dogAbs = absoluteFromStudioRelative(imgRow.outputArtifactPath);
    const urls = await readImageUrls([...petAbs, ...tpl.petStyleRefAbs, dogAbs]);
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, {});
    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.dog_critique_llm);
    const user = `Evaluate the latest dog illustration vs pet photos and style references.\nPet name exact: ${JSON.stringify(order.petNameRaw)}`;
    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION) {
    const imgRow = await latestSuccessfulStepRun(orderId, [
      STUDIO_STEP_KEYS.DOG_IMG_V1,
      STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
      STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY,
    ]);
    const refs: string[] = [];
    const photos = await loadOrderPhotos(orderId);
    refs.push(...photos.map((p) => absoluteFromStudioRelative(p.localRelativePath)));
    refs.push(...tpl.petStyleRefAbs);
    if (imgRow?.outputArtifactPath) refs.push(absoluteFromStudioRelative(imgRow.outputArtifactPath));

    let prompt = "";
    const note = order.humanRejectNote?.trim();
    if (note) {
      await db
        .update(schema.studioOrders)
        .set({ humanRejectNote: "", updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, orderId));
      // Turn the reviewer's note into a proper correction prompt (the raw note
      // is a poor image prompt on its own); fall back to the note if the LLM fails.
      const system = await loadPromptBody(STUDIO_PROMPT_KEYS.dog_critique_llm);
      const user = [
        `A human reviewer rejected the current dog illustration with this comment:`,
        `"${note}"`,
        ``,
        `Template slug: ${order.designSlug}`,
        `Write a correction prompt for the image model that fixes exactly what the reviewer flagged while preserving the style, pose and everything else. Return status "needs_correction" with the prompt.`,
      ].join("\n");
      const llm = await runLlm({
        system,
        user,
        imageDataUrls: await readImageUrls(refs),
      });
      if (llm.ok) {
        const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
        prompt = env?.prompt?.trim() ?? "";
      }
      if (!prompt) prompt = note;
    } else {
      const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.DOG_LLM_CRITIQUE]);
      prompt = env?.prompt?.trim() ?? "";
      if (!prompt && env?.key_issues?.length) {
        prompt = `Fix the following issues in the current illustration while keeping everything else unchanged: ${env.key_issues.join("; ")}`;
      }
    }
    if (!prompt) {
      return { ok: false, error: "Run dog critique LLM first or provide human reject note" };
    }
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, {});
    const gen = await runImg({ prompt, referenceImagePaths: refs });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.DOG_LLM_IDENTITY_PROMPT) {
    const imgRow = await latestSuccessfulStepRun(orderId, [
      STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
      STUDIO_STEP_KEYS.DOG_IMG_V1,
    ]);
    if (!imgRow?.outputArtifactPath) {
      return { ok: false, error: "Need a dog image before identity prompt" };
    }
    const photos = await loadOrderPhotos(orderId);
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const dogAbs = absoluteFromStudioRelative(imgRow.outputArtifactPath);
    const urls = await readImageUrls([...petAbs, dogAbs]);
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, {});
    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.dog_identity_prompt_llm);
    const user = `Improve identity only. Pet name (exact): ${JSON.stringify(order.petNameRaw)}`;
    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.DOG_IMG_V3_IDENTITY) {
    const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.DOG_LLM_IDENTITY_PROMPT]);
    const prompt = env?.prompt?.trim();
    if (!prompt) return { ok: false, error: "Run identity LLM prompt step first" };
    const latestDog = await latestSuccessfulStepRun(orderId, [
      STUDIO_STEP_KEYS.DOG_IMG_V2_CORRECTION,
      STUDIO_STEP_KEYS.DOG_IMG_V1,
    ]);
    const photos = await loadOrderPhotos(orderId);
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const refs = [...petAbs, ...tpl.petStyleRefAbs];
    if (latestDog?.outputArtifactPath) {
      refs.push(absoluteFromStudioRelative(latestDog.outputArtifactPath));
    }
    const runId = await insertRunStart(orderId, "dog", stepKey, attempt, {});
    const gen = await runImg({ prompt, referenceImagePaths: refs });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    await db
      .update(schema.studioOrders)
      .set({ status: "dog_awaiting_approval", updatedAt: new Date(), lastError: "" })
      .where(eq(schema.studioOrders.id, orderId));
    return { ok: true, stepRunId: runId };
  }

  /* ---------- Stage B ---------- */
  if (stepKey === STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT) {
    if (order.mode !== "name_only" && !order.approvedDogArtifactPath?.trim()) {
      return {
        ok: false,
        error: "Approve the dog illustration first (human gate saves approvedDogArtifactPath)",
      };
    }
    const runId = await insertRunStart(orderId, "text", stepKey, attempt, {});
    await db
      .update(schema.studioOrders)
      .set({ status: "text_in_progress", lastError: "", updatedAt: new Date() })
      .where(eq(schema.studioOrders.id, orderId));
    const urls = await readImageUrls([tpl.textStyleRefAbs]);
    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.text_style_prompt_llm);
    const user = [
      `Pet name exact (Unicode, never translate or transliterate): ${JSON.stringify(order.petNameRaw)}`,
      `Script hint: ${order.petNameScript}`,
      `Template: ${order.designSlug}`,
    ].join("\n");
    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.TEXT_IMG_V1) {
    if (order.mode !== "name_only" && !order.approvedDogArtifactPath?.trim()) {
      return { ok: false, error: "Approve dog stage first" };
    }
    const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.TEXT_LLM_STYLE_PROMPT]);
    const prompt = env?.prompt?.trim();
    if (!prompt) return { ok: false, error: "Run text prompt LLM first" };
    const runId = await insertRunStart(orderId, "text", stepKey, attempt, {});
    const gen = await runImg({
      prompt,
      referenceImagePaths: [tpl.textStyleRefAbs],
    });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE) {
    if (order.mode !== "name_only" && !order.approvedDogArtifactPath?.trim()) {
      return { ok: false, error: "Approve dog stage first" };
    }
    const imgRow = await latestSuccessfulStepRun(orderId, [STUDIO_STEP_KEYS.TEXT_IMG_V1]);
    if (!imgRow?.outputArtifactPath) return { ok: false, error: "No text image yet" };
    const textAbs = absoluteFromStudioRelative(imgRow.outputArtifactPath);
    const urls = await readImageUrls([tpl.textStyleRefAbs, textAbs]);
    const runId = await insertRunStart(orderId, "text", stepKey, attempt, {});
    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.text_critique_llm);
    const user = `Pet name exact: ${JSON.stringify(order.petNameRaw)}`;
    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION) {
    if (order.mode !== "name_only" && !order.approvedDogArtifactPath?.trim()) {
      return { ok: false, error: "Approve dog stage first" };
    }
    const imgRow = await latestSuccessfulStepRun(orderId, [
      STUDIO_STEP_KEYS.TEXT_IMG_V1,
      STUDIO_STEP_KEYS.TEXT_IMG_V2_CORRECTION,
    ]);
    const refs = [tpl.textStyleRefAbs];
    if (imgRow?.outputArtifactPath) refs.push(absoluteFromStudioRelative(imgRow.outputArtifactPath));

    let prompt = "";
    const note = order.humanRejectNote?.trim();
    if (note) {
      await db
        .update(schema.studioOrders)
        .set({ humanRejectNote: "", updatedAt: new Date() })
        .where(eq(schema.studioOrders.id, orderId));
      const system = await loadPromptBody(STUDIO_PROMPT_KEYS.text_critique_llm);
      const user = [
        `A human reviewer rejected the current name artwork with this comment:`,
        `"${note}"`,
        ``,
        `Pet name exact (Unicode, never translate or transliterate): ${JSON.stringify(order.petNameRaw)}`,
        `Script hint: ${order.petNameScript}`,
        `Template slug: ${order.designSlug}`,
        `Write a correction prompt for the image model that fixes exactly what the reviewer flagged while keeping the reference style and the exact spelling. Return status "needs_correction" with the prompt.`,
      ].join("\n");
      const llm = await runLlm({
        system,
        user,
        imageDataUrls: await readImageUrls(refs),
      });
      if (llm.ok) {
        const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
        prompt = env?.prompt?.trim() ?? "";
      }
      if (!prompt) prompt = note;
    } else {
      const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.TEXT_LLM_CRITIQUE]);
      prompt = env?.prompt?.trim() ?? "";
      if (!prompt && env?.key_issues?.length) {
        prompt = `Fix the following issues in the current name artwork while keeping the style and the exact pet name ${JSON.stringify(order.petNameRaw)} unchanged: ${env.key_issues.join("; ")}`;
      }
    }
    if (!prompt) return { ok: false, error: "Run text critique LLM first or provide human reject note" };
    const runId = await insertRunStart(orderId, "text", stepKey, attempt, {});
    const gen = await runImg({ prompt, referenceImagePaths: refs });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    await db
      .update(schema.studioOrders)
      .set({ status: "text_awaiting_approval", updatedAt: new Date(), lastError: "" })
      .where(eq(schema.studioOrders.id, orderId));
    return { ok: true, stepRunId: runId };
  }

  /* ---------- Stage C ---------- */
  if (stepKey === STUDIO_STEP_KEYS.FINAL_IMG_V1) {
    if (!order.approvedDogArtifactPath || !order.approvedTextArtifactPath) {
      return {
        ok: false,
        error: "Approve dog + text stages first (sets approved artifact paths)",
      };
    }
    const runId = await insertRunStart(orderId, "final", stepKey, attempt, {});
    await db
      .update(schema.studioOrders)
      .set({ status: "final_in_progress", lastError: "", updatedAt: new Date() })
      .where(eq(schema.studioOrders.id, orderId));
    const basePrompt = await loadPromptBody(STUDIO_PROMPT_KEYS.final_composition_image_prompt);
    const rulesNote = [
      `Replacement rules JSON: ${JSON.stringify(tpl.replacementRules)}`,
      tpl.compositionNotes ? `Template notes:\n${tpl.compositionNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const prompt = [
      basePrompt,
      rulesNote,
      `Pet name exact on print: ${JSON.stringify(order.petNameRaw)}`,
    ].join("\n\n");
    const refs = [
      tpl.designAbs,
      absoluteFromStudioRelative(order.approvedDogArtifactPath),
      absoluteFromStudioRelative(order.approvedTextArtifactPath),
    ];
    const gen = await runImg({ prompt, referenceImagePaths: refs });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    await db
      .update(schema.studioOrders)
      .set({ status: "final_awaiting_approval", updatedAt: new Date(), lastError: "" })
      .where(eq(schema.studioOrders.id, orderId));
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE) {
    const imgRow = await latestSuccessfulStepRun(orderId, [STUDIO_STEP_KEYS.FINAL_IMG_V1]);
    if (!imgRow?.outputArtifactPath) return { ok: false, error: "No final image v1 yet" };
    const photos = await loadOrderPhotos(orderId);
    const petAbs = photos.map((p) => absoluteFromStudioRelative(p.localRelativePath));
    const finalAbs = absoluteFromStudioRelative(imgRow.outputArtifactPath);
    const dogAbs = order.approvedDogArtifactPath
      ? absoluteFromStudioRelative(order.approvedDogArtifactPath)
      : "";
    const textAbs = order.approvedTextArtifactPath
      ? absoluteFromStudioRelative(order.approvedTextArtifactPath)
      : "";
    const urls = await readImageUrls(
      [tpl.designAbs, finalAbs, dogAbs, textAbs, ...petAbs].filter(Boolean),
    );
    const runId = await insertRunStart(orderId, "final", stepKey, attempt, {});
    const system = await loadPromptBody(STUDIO_PROMPT_KEYS.final_critique_llm);
    const user = `Evaluate final composite vs master and likeness. Pet name exact: ${JSON.stringify(order.petNameRaw)}`;
    const llm = await runLlm({ system, user, imageDataUrls: urls });
    if (!llm.ok) {
      await finishRun(runId, { status: "failed", error: llm.error });
      await failOrder(orderId, llm.error);
      return { ok: false, error: llm.error };
    }
    const env = llm.parsed ?? parseLlmReviewEnvelope(llm.raw);
    await finishRun(runId, {
      status: "success",
      llmOutputJson: envelopeJson(env, llm.raw),
      rawLlmResponseText: llm.raw.slice(0, 120_000),
      promptBundleJson: JSON.stringify({ system, user }),
    });
    return { ok: true, stepRunId: runId };
  }

  if (stepKey === STUDIO_STEP_KEYS.FINAL_IMG_V2_CORRECTION) {
    const env = await envelopeFromLatestStep(orderId, [STUDIO_STEP_KEYS.FINAL_LLM_CRITIQUE]);
    const prompt = env?.prompt?.trim();
    if (!prompt) return { ok: false, error: "Run final critique LLM first" };
    const imgRow = await latestSuccessfulStepRun(orderId, [STUDIO_STEP_KEYS.FINAL_IMG_V1]);
    const refs = [
      tpl.designAbs,
      absoluteFromStudioRelative(order.approvedDogArtifactPath),
      absoluteFromStudioRelative(order.approvedTextArtifactPath),
    ];
    if (imgRow?.outputArtifactPath) refs.push(absoluteFromStudioRelative(imgRow.outputArtifactPath));
    const runId = await insertRunStart(orderId, "final", stepKey, attempt, {});
    const gen = await runImg({ prompt, referenceImagePaths: refs });
    if (!gen.ok) {
      await finishRun(runId, { status: "failed", error: gen.error });
      await failOrder(orderId, gen.error);
      return { ok: false, error: gen.error };
    }
    const rel = path.posix.join("artifacts", orderId, `${runId}.png`);
    await fs.mkdir(path.dirname(absoluteFromStudioRelative(rel)), { recursive: true });
    await fs.writeFile(absoluteFromStudioRelative(rel), gen.bytes);
    await finishRun(runId, {
      status: "success",
      outputArtifactPath: rel,
      promptBundleJson: JSON.stringify({ prompt }),
    });
    await db
      .update(schema.studioOrders)
      .set({ status: "final_awaiting_approval", updatedAt: new Date(), lastError: "" })
      .where(eq(schema.studioOrders.id, orderId));
    return { ok: true, stepRunId: runId };
  }

  return { ok: false, error: `Step ${stepKey} is not an automated run (use human actions API)` };
}
