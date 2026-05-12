import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { requireStudioSession } from "@/lib/studio/http-guard";

type Ctx = { params: Promise<{ slug: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { slug } = await ctx.params;
  let inbound: {
    name?: string;
    compositionNotes?: string;
    replacementRulesJson?: string;
    designTemplatePath?: string;
    petStyleRefPathsJson?: string;
    textStyleRefPath?: string;
  };
  try {
    inbound = (await req.json()) as typeof inbound;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const db = getStudioDb();
  const patch: Partial<typeof schema.studioTemplates.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof inbound.name === "string") patch.name = inbound.name;
  if (typeof inbound.compositionNotes === "string") patch.compositionNotes = inbound.compositionNotes;
  if (typeof inbound.replacementRulesJson === "string") {
    patch.replacementRulesJson = inbound.replacementRulesJson;
  }
  if (typeof inbound.designTemplatePath === "string") {
    patch.designTemplatePath = inbound.designTemplatePath;
  }
  if (typeof inbound.petStyleRefPathsJson === "string") {
    patch.petStyleRefPathsJson = inbound.petStyleRefPathsJson;
  }
  if (typeof inbound.textStyleRefPath === "string") patch.textStyleRefPath = inbound.textStyleRefPath;

  await db.update(schema.studioTemplates).set(patch).where(eq(schema.studioTemplates.slug, slug));
  const [row] = await db
    .select()
    .from(schema.studioTemplates)
    .where(eq(schema.studioTemplates.slug, slug))
    .limit(1);
  return NextResponse.json({ ok: true, template: row ?? null });
}
