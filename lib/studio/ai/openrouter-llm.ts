import "server-only";

import { parseOpenRouterUsage, recordAiCall, type AiCallContext, type AiUsage } from "@/lib/studio/ai/usage";
import { getOpenRouterBaseUrl, getOpenRouterProxySecret, isStudioMockMode } from "@/lib/studio/env";
import { getEnvRaw } from "@/lib/studio/runtime-env";
import {
  parseLlmReviewEnvelope,
  type LlmReviewEnvelope,
} from "@/lib/studio/types/llm-json";

export type OpenRouterLlmResult =
  | { ok: true; raw: string; parsed: LlmReviewEnvelope | null; usage?: AiUsage }
  | { ok: false; error: string };

/**
 * OpenRouter chat completion. Prefer JSON-only answers; we parse leniently.
 * When STUDIO_MOCK_AI is set, returns a canned envelope without calling the network.
 */
export async function openRouterChatJson(opts: {
  model?: string;
  system: string;
  user: string;
  /** data:image/...;base64,... */
  imageDataUrls?: string[];
}): Promise<OpenRouterLlmResult> {
  if (isStudioMockMode()) {
    const raw = JSON.stringify({
      status: "ok",
      prompt: "MOCK: keep the current image unchanged",
      reasoning_summary: "Mock mode — no live LLM call.",
      key_issues: [],
      confidence: 0.5,
    } satisfies LlmReviewEnvelope);
    return { ok: true, raw, parsed: parseLlmReviewEnvelope(raw) };
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = opts.model?.trim() || getEnvRaw("STUDIO_LLM_MODEL")?.trim();
  if (!apiKey || !model) {
    return {
      ok: false,
      error:
        "Missing OPENROUTER_API_KEY or model (set STUDIO_LLM_MODEL or pass opts.model)",
    };
  }

  const userContent: unknown[] = [{ type: "text", text: opts.user }];
  for (const url of opts.imageDataUrls ?? []) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  try {
    const proxySecret = getOpenRouterProxySecret();
    const res = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPS_PUBLIC_BASE_URL?.trim() || "https://dogood.local",
        "X-Title": "DoGood Studio LLM",
        ...(proxySecret ? { "X-Proxy-Secret": proxySecret } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        usage: { include: true },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userContent },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `OpenRouter HTTP ${res.status}: ${raw.slice(0, 500)}` };
    }
    const usage = parseOpenRouterUsage(raw, model);
    let assistant = "";
    try {
      const j = JSON.parse(raw) as {
        choices?: { message?: { content?: string | unknown[] } }[];
      };
      const c = j.choices?.[0]?.message?.content;
      if (typeof c === "string") assistant = c;
      else if (Array.isArray(c)) {
        assistant = c
          .map((p) =>
            typeof p === "object" &&
            p &&
            "text" in p &&
            typeof (p as { text?: string }).text === "string"
              ? (p as { text: string }).text
              : "",
          )
          .join("");
      }
    } catch {
      return { ok: false, error: "OpenRouter: could not parse JSON body" };
    }
    return {
      ok: true,
      raw: assistant,
      parsed: parseLlmReviewEnvelope(assistant),
      usage,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/** Same as openRouterChatJson, but records the call's token/$ cost. */
export async function openRouterChatJsonTracked(
  ctx: AiCallContext,
  opts: Parameters<typeof openRouterChatJson>[0],
): Promise<OpenRouterLlmResult> {
  const r = await openRouterChatJson(opts);
  if (r.ok) await recordAiCall(ctx, "llm", r.usage);
  return r;
}
