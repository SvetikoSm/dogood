import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { requireStudioSession } from "@/lib/studio/http-guard";

type Ctx = { params: Promise<{ key: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { key } = await ctx.params;
  let inbound: { title?: string; body?: string };
  try {
    inbound = (await req.json()) as { title?: string; body?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const db = getStudioDb();
  const patch: Partial<typeof schema.studioPromptDefinitions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof inbound.title === "string") patch.title = inbound.title;
  if (typeof inbound.body === "string") patch.body = inbound.body;
  await db.update(schema.studioPromptDefinitions).set(patch).where(eq(schema.studioPromptDefinitions.key, key));
  const [row] = await db
    .select()
    .from(schema.studioPromptDefinitions)
    .where(eq(schema.studioPromptDefinitions.key, key))
    .limit(1);
  return NextResponse.json({ ok: true, prompt: row ?? null });
}
