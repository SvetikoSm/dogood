/**
 * Seeds default templates, editable prompts, and a demo order with a cached pet photo.
 * Run after: npm run studio:db:push
 *
 *   npm run studio:seed
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../lib/studio/db/schema";
import { STUDIO_DEFAULT_PROMPTS } from "../lib/studio/prompt-defaults";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOskAAAAAElFTkSuQmCC",
  "base64",
);

async function writePng(rel: string) {
  const root = path.join(process.cwd(), "data", "studio");
  const abs = path.join(root, ...rel.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, TINY_PNG);
}

async function main() {
  const dbPath = path.join(process.cwd(), "data", "studio", "studio.db");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const url = `file:${dbPath.replace(/\\/g, "/")}`;
  const client = createClient({ url });
  const db = drizzle(client, { schema });

  const slugs = ["speed", "life", "rainy"] as const;
  const names: Record<(typeof slugs)[number], string> = {
    speed: "Design 1 — I am speed",
    life: "Design 2 — Life is better",
    rainy: "Design 3 — No rainy days",
  };

  for (const slug of slugs) {
    const base = `templates/${slug}`;
    await writePng(`${base}/design.png`);
    await writePng(`${base}/pet_ref_1.png`);
    await writePng(`${base}/pet_ref_2.png`);
    await writePng(`${base}/text_ref.png`);

    const petStyleRefPathsJson = JSON.stringify([
      `${base}/pet_ref_1.png`,
      `${base}/pet_ref_2.png`,
    ]);

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
        ? "Also replace repeated pet name occurrences inside supporting text blocks (not only the hero name)."
        : "";

    await db
      .insert(schema.studioTemplates)
      .values({
        id: randomUUID(),
        slug,
        name: names[slug],
        designTemplatePath: `${base}/design.png`,
        petStyleRefPathsJson,
        textStyleRefPath: `${base}/text_ref.png`,
        replacementRulesJson: JSON.stringify(replacementRules),
        compositionNotes,
      })
      .onConflictDoUpdate({
        target: schema.studioTemplates.slug,
        set: {
          name: names[slug],
          designTemplatePath: `${base}/design.png`,
          petStyleRefPathsJson,
          textStyleRefPath: `${base}/text_ref.png`,
          replacementRulesJson: JSON.stringify(replacementRules),
          compositionNotes,
          updatedAt: new Date(),
        },
      });
  }

  for (const p of STUDIO_DEFAULT_PROMPTS) {
    await db
      .insert(schema.studioPromptDefinitions)
      .values({
        key: p.key,
        title: p.title,
        body: p.body,
      })
      .onConflictDoUpdate({
        target: schema.studioPromptDefinitions.key,
        set: { title: p.title, body: p.body, updatedAt: new Date() },
      });
  }

  const existing = await db
    .select()
    .from(schema.studioOrders)
    .where(eq(schema.studioOrders.sheetOrderId, "STUDIO-DEMO-1"))
    .limit(1);

  let oid: string;
  if (existing[0]) {
    oid = existing[0].id;
    await db
      .update(schema.studioOrders)
      .set({
        customerName: "Demo Customer",
        petNameRaw: "Барсик",
        petNameScript: "cyrillic",
        designSlug: "speed",
        status: "assets_loaded",
        sheetPayloadJson: JSON.stringify({ demo: true }),
        updatedAt: new Date(),
      })
      .where(eq(schema.studioOrders.id, oid));
  } else {
    oid = randomUUID();
    await db.insert(schema.studioOrders).values({
      id: oid,
      sheetOrderId: "STUDIO-DEMO-1",
      customerName: "Demo Customer",
      petNameRaw: "Барсик",
      petNameScript: "cyrillic",
      designSlug: "speed",
      driveFolderUrl: "",
      driveFolderId: "",
      status: "assets_loaded",
      sheetPayloadJson: JSON.stringify({ demo: true }),
    });
  }

  const demoRel = path.posix.join("cache", oid, "0_demo.png");
  await writePng(demoRel);

  await db.delete(schema.studioOrderPhotos).where(eq(schema.studioOrderPhotos.orderId, oid));
  await db.insert(schema.studioOrderPhotos).values({
    id: randomUUID(),
    orderId: oid,
    sortOrder: 0,
    driveFileId: "",
    originalName: "demo.png",
    mimeType: "image/png",
    localRelativePath: demoRel,
  });

  console.log("Studio seed OK. Demo order sheet id: STUDIO-DEMO-1");
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
