import "server-only";

import { isGenerationDryRun } from "@/lib/ops/generation-dry-run";

export type OpenRouterImageRequest = {
  prompt: string;
  /** data:image/...;base64,... */
  imageDataUrls: string[];
};

/**
 * Вызов OpenRouter (мультимодельный чат). Реальный парсинг ответа с картинкой зависит от модели;
 * пока: dry-run, либо попытка запроса с понятной ошибкой в логах.
 */
export async function requestImageViaOpenRouter(
  req: OpenRouterImageRequest,
): Promise<
  | {
      ok: true;
      note: string;
      imageBase64?: string;
      mimeType?: string;
      /** true если ответ 2xx, но изображение из тела ещё не извлекаем */
      needsImageParser?: boolean;
    }
  | { ok: false; error: string }
> {
  if (isGenerationDryRun()) {
    return {
      ok: true,
      note: "GENERATION_DRY_RUN: запрос к OpenRouter не выполнялся",
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_IMAGE_MODEL?.trim();
  if (!apiKey || !model) {
    return {
      ok: false,
      error: "Задайте OPENROUTER_API_KEY и OPENROUTER_IMAGE_MODEL (или включите GENERATION_DRY_RUN)",
    };
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: req.prompt }];
  for (const url of req.imageDataUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPS_PUBLIC_BASE_URL?.trim() || "https://dogood.local",
        "X-Title": "DoGood generation",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        max_tokens: 4096,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `OpenRouter HTTP ${res.status}: ${text.slice(0, 400)}` };
    }

    /* У разных моделей поле с изображением разное — пока не парсим бинарь */
    return {
      ok: true,
      needsImageParser: true,
      note: `OpenRouter ответил (${text.length} символов); добавьте парсер картинки под вашу модель`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
