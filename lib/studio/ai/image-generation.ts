import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { getStudioImageHttpUrl, getStudioImageModel, isStudioMockMode } from "@/lib/studio/env";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

export type ImageGenInput = {
  prompt: string;
  /** Absolute file paths on disk (png/jpeg/webp) */
  referenceImagePaths?: string[];
};

export type ImageGenResult =
  | { ok: true; mimeType: string; bytes: Buffer }
  | { ok: false; error: string };

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOskAAAAAElFTkSuQmCC";

async function readFileAsDataUrl(abs: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function extractImageFromOpenRouterResponse(raw: string): Buffer | null {
  try {
    const j = JSON.parse(raw) as {
      choices?: {
        message?: {
          content?: string;
          images?: { image_url?: { url?: string }; imageUrl?: { url?: string } }[];
        };
      }[];
    };
    const msg = j.choices?.[0]?.message;
    const images = msg?.images ?? [];
    const first = images[0];
    const url =
      first?.image_url?.url ||
      first?.imageUrl?.url ||
      (typeof msg?.content === "string"
        ? msg.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/)?.[0]
        : undefined);
    if (url) {
      const m = String(url).match(/^data:([^;]+);base64,(.+)$/);
      if (m?.[2]) {
        try {
          return Buffer.from(m[2], "base64");
        } catch {
          /* fall through */
        }
      }
    }
    const assistant = msg?.content ?? "";
    return extractBase64ImageFromAssistantText(assistant);
  } catch {
    return extractBase64ImageFromAssistantText(raw);
  }
}
function extractBase64ImageFromAssistantText(text: string): Buffer | null {
  const data = text.match(/data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/);
  if (data?.[1]) {
    try {
      return Buffer.from(data[1], "base64");
    } catch {
      return null;
    }
  }
  const fence = text.match(/```(?:png|image)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.includes("base64,")) {
    const inner = fence[1].match(/base64,([A-Za-z0-9+/=]+)/);
    if (inner?.[1]) {
      try {
        return Buffer.from(inner[1], "base64");
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Pluggable image generation:
 * - Mock: tiny PNG, no network
 * - Optional HTTP adapter: POST to STUDIO_IMAGE_HTTP_URL (see README)
 * - Fallback: OpenRouter chat with STUDIO_IMAGE_MODEL; tries to scrape base64 from assistant text
 */
export async function generateStudioImage(input: ImageGenInput): Promise<ImageGenResult> {
  if (isStudioMockMode()) {
    const bytes = Buffer.from(MOCK_PNG_BASE64, "base64");
    return { ok: true, mimeType: "image/png", bytes };
  }

  const httpUrl = getStudioImageHttpUrl();
  if (httpUrl) {
    const refs: string[] = [];
    for (const p of input.referenceImagePaths ?? []) {
      const u = await readFileAsDataUrl(p);
      if (u) refs.push(u);
    }
    try {
      const res = await fetch(httpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input.prompt,
          images: refs,
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        return { ok: false, error: `Image HTTP ${res.status}: ${raw.slice(0, 400)}` };
      }
      const j = JSON.parse(raw) as { imageBase64?: string; mimeType?: string };
      if (!j.imageBase64) {
        return { ok: false, error: "Image HTTP: missing imageBase64 in JSON" };
      }
      return {
        ok: true,
        mimeType: j.mimeType || "image/png",
        bytes: Buffer.from(j.imageBase64, "base64"),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = getStudioImageModel();
  if (!apiKey || !model) {
    return {
      ok: false,
      error:
        "Configure STUDIO_IMAGE_HTTP_URL or STUDIO_IMAGE_MODEL + OPENROUTER_API_KEY, or enable STUDIO_MOCK_AI",
    };
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: input.prompt }];
  for (const p of input.referenceImagePaths ?? []) {
    const u = await readFileAsDataUrl(p);
    if (u) content.push({ type: "image_url", image_url: { url: u } });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPS_PUBLIC_BASE_URL?.trim() || "https://dogood.local",
        "X-Title": "DoGood Studio Image",
      },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [{ role: "user", content }],
        max_tokens: 8192,
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `OpenRouter image HTTP ${res.status}: ${raw.slice(0, 400)}` };
    }
    const buf = extractImageFromOpenRouterResponse(raw);
    if (!buf) {
      return {
        ok: false,
        error:
          "Could not extract image from model response — switch model, use STUDIO_IMAGE_HTTP_URL, or enable mock mode.",
      };
    }
    return { ok: true, mimeType: "image/png", bytes: buf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Load bytes from a studio-relative artifact path (for chaining steps). */
export async function readStudioArtifactBytes(
  studioRelativePath: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(absoluteFromStudioRelative(studioRelativePath));
  } catch {
    return null;
  }
}
