import "server-only";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { STUDIO_DEFAULT_PROMPTS } from "@/lib/studio/prompt-defaults";
import type { StudioPromptKey } from "@/lib/studio/step-keys";

export async function loadPromptBody(key: StudioPromptKey): Promise<string> {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioPromptDefinitions)
    .where(eq(schema.studioPromptDefinitions.key, key))
    .limit(1);
  const row = rows[0];
  if (row?.body?.trim()) return row.body.trim();
  return STUDIO_DEFAULT_PROMPTS.find((p) => p.key === key)?.body ?? "";
}
