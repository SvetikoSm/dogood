import "server-only";

import { eq } from "drizzle-orm";

import { getStudioDb, schema } from "@/lib/studio/db";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

export type ReplacementRules = {
  replaceDog: boolean;
  replaceMainName: boolean;
  /** Design 3 — repeated pet name inside supporting copy */
  replaceSecondaryPetNameInCopy: boolean;
};

export type ResolvedTemplate = {
  slug: string;
  name: string;
  designAbs: string;
  petStyleRefAbs: string[];
  textStyleRefAbs: string;
  replacementRules: ReplacementRules;
  compositionNotes: string;
};

export function parseReplacementRules(json: string): ReplacementRules {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return {
      replaceDog: Boolean(o.replaceDog ?? true),
      replaceMainName: Boolean(o.replaceMainName ?? true),
      replaceSecondaryPetNameInCopy: Boolean(o.replaceSecondaryPetNameInCopy ?? false),
    };
  } catch {
    return {
      replaceDog: true,
      replaceMainName: true,
      replaceSecondaryPetNameInCopy: false,
    };
  }
}

export async function resolveTemplateForSlug(
  slug: string,
): Promise<ResolvedTemplate | null> {
  const db = getStudioDb();
  const rows = await db
    .select()
    .from(schema.studioTemplates)
    .where(eq(schema.studioTemplates.slug, slug))
    .limit(1);
  const t = rows[0];
  if (!t) return null;
  let petRefs: string[] = [];
  try {
    petRefs = JSON.parse(t.petStyleRefPathsJson) as string[];
    if (!Array.isArray(petRefs)) petRefs = [];
  } catch {
    petRefs = [];
  }
  return {
    slug: t.slug,
    name: t.name,
    designAbs: absoluteFromStudioRelative(t.designTemplatePath),
    petStyleRefAbs: petRefs.map((r) => absoluteFromStudioRelative(r)),
    textStyleRefAbs: absoluteFromStudioRelative(t.textStyleRefPath),
    replacementRules: parseReplacementRules(t.replacementRulesJson),
    compositionNotes: t.compositionNotes ?? "",
  };
}
