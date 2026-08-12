import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { StyleSlug } from "@/lib/ops/style-masters";
import { STYLE_MASTER_FILE_LABEL } from "@/lib/ops/style-masters";
import { getStudioDriveFolder } from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import {
  downloadDriveFile,
  downloadDriveFolderFileToRelative,
  extFromMime,
  listDriveFolderImages,
  listDriveSubfolders,
  mockupCandidatesForSlug,
} from "@/lib/studio/google/drive-files";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

const SLUGS: StyleSlug[] = ["speed", "life", "rainy"];

/** The pet-refs Drive folder contains one subfolder per style. */
const PET_REF_SUBFOLDER_HINTS: Record<StyleSlug, string[]> = {
  life: ["life is good", "life is better", "life"],
  rainy: ["no rainy days", "rainy"],
  speed: ["я - скорость", "я — скорость", "скорость", "speed"],
};

const MAX_PET_REFS = 4;

/**
 * Text-style reference files are named by style in the text-refs Drive folder.
 * (Previously fetched by hardcoded file id, which had all three styles swapped.)
 */
const TEXT_REF_NAME_CANDIDATES: Record<StyleSlug, string[]> = {
  life: ["Life is better", "life is good", "life"],
  rainy: ["No rainy days", "rainy"],
  speed: ["I am speed", "я - скорость", "я — скорость", "скорость", "speed"],
};

function matchSubfolder(
  folders: { id: string; name: string }[],
  hints: string[],
): { id: string; name: string } | null {
  for (const hint of hints) {
    const hit = folders.find((f) => f.name.trim().toLowerCase().includes(hint));
    if (hit) return hit;
  }
  return null;
}

/**
 * Pull mockup masters + pet/text style refs from Google Drive into data/studio/templates/.
 */
export async function syncStudioTemplatesFromDrive(): Promise<{
  ok: true;
  updated: number;
  detail: string[];
} | { ok: false; error: string }> {
  const mockupFolder = getStudioDriveFolder("mockupMasters");
  const petFolder = getStudioDriveFolder("petStyleRefs");
  const textFolder = getStudioDriveFolder("textStyleRefs");

  const petSubfolders = await listDriveSubfolders(petFolder);
  if ("ok" in petSubfolders && petSubfolders.ok === false) return petSubfolders;

  const detail: string[] = [];
  const db = getStudioDb();
  let updated = 0;

  for (const slug of SLUGS) {
    const base = `templates/${slug}`;
    const mockup = await downloadDriveFolderFileToRelative(
      mockupFolder,
      mockupCandidatesForSlug(slug),
      `${base}/design.png`,
    );
    if (!mockup.ok) {
      detail.push(`${slug} mockup: ${mockup.error}`);
      continue;
    }

    const petRefs: string[] = [];
    const sub = matchSubfolder(
      petSubfolders as { id: string; name: string }[],
      PET_REF_SUBFOLDER_HINTS[slug],
    );
    if (!sub) {
      detail.push(
        `${slug} pet refs: no subfolder matching [${PET_REF_SUBFOLDER_HINTS[slug].join(", ")}]`,
      );
    } else {
      const imgs = await listDriveFolderImages(sub.id);
      if ("ok" in imgs && imgs.ok === false) {
        detail.push(`${slug} pet refs: ${imgs.error}`);
      } else {
        for (const f of (imgs as { id: string; name: string; mimeType: string }[]).slice(
          0,
          MAX_PET_REFS,
        )) {
          const rel = `${base}/pet_ref_${petRefs.length + 1}${extFromMime(f.mimeType)}`;
          const dl = await downloadDriveFile(f.id, absoluteFromStudioRelative(rel));
          if (dl.ok) petRefs.push(rel);
        }
      }
    }

    const textRel = `${base}/text_ref.png`;
    const textDl = await downloadDriveFolderFileToRelative(
      textFolder,
      TEXT_REF_NAME_CANDIDATES[slug],
      textRel,
    );
    if (!textDl.ok) detail.push(`${slug} text ref: ${textDl.error}`);

    const replacementRules =
      slug === "rainy"
        ? {
            replaceDog: true,
            replaceMainName: true,
            replaceSecondaryPetNameInCopy: true,
          }
        : { replaceDog: true, replaceMainName: true, replaceSecondaryPetNameInCopy: false };

    const compositionNotes =
      slug === "rainy"
        ? "Also replace repeated pet name occurrences inside supporting text blocks."
        : "";

    await db
      .insert(schema.studioTemplates)
      .values({
        id: randomUUID(),
        slug,
        name: STYLE_MASTER_FILE_LABEL[slug],
        designTemplatePath: `${base}/design.png`,
        petStyleRefPathsJson: JSON.stringify(petRefs),
        textStyleRefPath: textRel,
        replacementRulesJson: JSON.stringify(replacementRules),
        compositionNotes,
      })
      .onConflictDoUpdate({
        target: schema.studioTemplates.slug,
        set: {
          name: STYLE_MASTER_FILE_LABEL[slug],
          designTemplatePath: `${base}/design.png`,
          petStyleRefPathsJson: JSON.stringify(petRefs),
          textStyleRefPath: textRel,
          replacementRulesJson: JSON.stringify(replacementRules),
          compositionNotes,
          updatedAt: new Date(),
        },
      });

    updated += 1;
    detail.push(`${slug}: mockup + ${petRefs.length} pet refs + text ref`);
  }

  return { ok: true, updated, detail };
}
