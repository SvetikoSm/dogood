export type LlmReviewEnvelope = {
  status: "ok" | "needs_correction";
  prompt: string;
  reasoning_summary: string;
  key_issues: string[];
  confidence: number;
};

export function stripJsonFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return t.trim();
}

export function parseLlmReviewEnvelope(raw: string): LlmReviewEnvelope | null {
  const text = stripJsonFences(raw);
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    const status = o.status === "needs_correction" ? "needs_correction" : "ok";
    const prompt = typeof o.prompt === "string" ? o.prompt : "";
    const reasoning_summary =
      typeof o.reasoning_summary === "string" ? o.reasoning_summary : "";
    const key_issues = Array.isArray(o.key_issues)
      ? o.key_issues.filter((x): x is string => typeof x === "string")
      : [];
    const confidence =
      typeof o.confidence === "number" && Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0;
    return { status, prompt, reasoning_summary, key_issues, confidence };
  } catch {
    return null;
  }
}
