import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { StyleSlug } from "@/lib/ops/style-masters";
import { STYLE_MASTER_FILE_LABEL } from "@/lib/ops/style-masters";
import {
  getStudioDriveFolder,
  N8N_TEXT_STYLE_REF_FILE_IDS,
} from "@/lib/studio/config";
import { getStudioDb, schema } from "@/lib/studio/db";
import {
  downloadDriveFile,
  downloadDriveFolderFileToRelative,
  listDriveFolderImages,
  mockupCandidatesForSlug,
} from "@/lib/studio/google/drive-files";
import { absoluteFromStudioRelative } from "@/lib/studio/paths";

const SLUGS: StyleSlug[] = ["speed", "life", "rainy"];

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

  const petListed = await listDriveFolderImages(petFolder);
  if ("ok" in petListed && petListed.ok === false) return petListed;

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

    const petCandidates = [
      STYLE_MASTER_FILE_LABEL[slug],
      ...mockupCandidatesForSlug(slug),
    ];
    const petRefs: string[] = [];
    let petIdx = 0;
    for (const name of petCandidates) {
      const hit = (petListed as { id: string; name: string; mimeType: string }[]).find(
        (f) =>
          f.name.replace(/\.[^.]+$/, "").toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(f.name.replace(/\.[^.]+$/, "").toLowerCase()),
      );
      if (!hit) continue;
      petIdx += 1;
      const rel = `${base}/pet_ref_${petIdx}.png`;
      const dl = await downloadDriveFile(hit.id, absoluteFromStudioRelative(rel));
      if (dl.ok) petRefs.push(rel);
      if (petRefs.length >= 2) break;
    }

    const textFileId = N8N_TEXT_STYLE_REF_FILE_IDS[slug];
    const textRel = `${base}/text_ref.png`;
    const textDl = await downloadDriveFile(
      textFileId,
      absoluteFromStudioRelative(textRel),
    );
    if (!textDl.ok) {
      const fromFolder = await downloadDriveFolderFileToRelative(
        textFolder,
        mockupCandidatesForSlug(slug),
        textRel,
      );
      if (!fromFolder.ok) detail.push(`${slug} text ref: ${fromFolder.error}`);
    }

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
        petStyleRefPathsJson: JSON.stringify(petRefs.length ? petRefs : [`${base}/pet_ref_1.png`]),
        textStyleRefPath: textRel,
        replacementRulesJson: JSON.stringify(replacementRules),
        compositionNotes,
      })
      .onConflictDoUpdate({
        target: schema.studioTemplates.slug,
        set: {
          name: STYLE_MASTER_FILE_LABEL[slug],
          designTemplatePath: `${base}/design.png`,
          petStyleRefPathsJson: JSON.stringify(petRefs.length ? petRefs : [`${base}/pet_ref_1.png`]),
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
