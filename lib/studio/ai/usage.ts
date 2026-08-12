import "server-only";

import { randomUUID } from "node:crypto";

import { getStudioDb, schema } from "@/lib/studio/db";

export type AiUsage = {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** USD, from OpenRouter `usage.cost` */
  costUsd?: number;
};

export type AiCallContext = {
  orderId: string;
  stepKey: string;
};

/** Parse the `usage` block OpenRouter returns on a chat/completions response. */
export function parseOpenRouterUsage(rawBody: string, model: string): AiUsage {
  try {
    const j = JSON.parse(rawBody) as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
      model?: string;
    };
    const u = j.usage ?? {};
    return {
      model: j.model || model,
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
      costUsd: typeof u.cost === "number" ? u.cost : 0,
    };
  } catch {
    return { model };
  }
}

/** Persist one billed call. Never throws — cost logging must not break the pipeline. */
export async function recordAiCall(
  ctx: AiCallContext,
  kind: "llm" | "image",
  usage: AiUsage | undefined,
): Promise<void> {
  if (!usage) return;
  try {
    await getStudioDb()
      .insert(schema.studioAiCalls)
      .values({
        id: randomUUID(),
        orderId: ctx.orderId,
        stepKey: ctx.stepKey,
        kind,
        model: usage.model ?? "",
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        costUsd: usage.costUsd ?? 0,
      });
  } catch (e) {
    console.error("[recordAiCall]", e instanceof Error ? e.message : e);
  }
}
