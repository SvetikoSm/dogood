import { NextResponse } from "next/server";

import { openRouterChatJson } from "@/lib/studio/ai/openrouter-llm";
import { requireStudioSession } from "@/lib/studio/http-guard";
import { parseLlmReviewEnvelope } from "@/lib/studio/types/llm-json";

export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  let body: {
    system?: string;
    user?: string;
    model?: string;
    imageDataUrls?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const system = body.system?.trim() ?? "You are a helpful assistant.";
  const user = body.user?.trim() ?? "";
  if (!user) {
    return NextResponse.json({ ok: false, error: "user message required" }, { status: 400 });
  }
  const r = await openRouterChatJson({
    system,
    user,
    model: body.model?.trim(),
    imageDataUrls: body.imageDataUrls,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    raw: r.raw,
    parsed: r.parsed ?? parseLlmReviewEnvelope(r.raw),
  });
}
