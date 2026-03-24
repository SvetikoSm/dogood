import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { CatalogDesign } from "@/lib/landing-data";
import { catalogDesignTemplates } from "@/lib/landing-data";

const PUBLIC_ROOT = path.join(process.cwd(), "public");

const MAIN_RE = /^main\.(jpe?g|webp|png)$/i;
const COVER_RE = /^cover\.(jpe?g|webp|png)$/i;
const GALLERY_RE = /^(\d+)\.(jpe?g|webp|png)$/i;

function fileExists(relFromPublic: string): boolean {
  return existsSync(path.join(PUBLIC_ROOT, relFromPublic));
}

function publicUrl(relFromPublic: string): string {
  return `/${relFromPublic.replace(/\\/g, "/")}`;
}

function listProductDir(folder: string): string[] {
  const dir = path.join(PUBLIC_ROOT, "products", folder);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Учитывает Windows: любой регистр имени и расширения (.JPG и т.д.) */
function resolveMainImage(folder: string, fallback: string): string {
  const files = listProductDir(folder);
  const mainFile =
    files.find((f) => MAIN_RE.test(f)) || files.find((f) => COVER_RE.test(f));
  if (mainFile) return publicUrl(`products/${folder}/${mainFile}`);

  for (const name of [
    "main.jpg",
    "main.webp",
    "main.png",
    "cover.jpg",
    "cover.webp",
  ]) {
    const rel = `products/${folder}/${name}`;
    if (fileExists(rel)) return publicUrl(rel);
  }
  return fallback;
}

function resolveGallery(folder: string, fallback: string[]): string[] {
  const files = listProductDir(folder);
  const numbered = files
    .map((f) => {
      const m = f.match(GALLERY_RE);
      return m ? { n: parseInt(m[1]!, 10), f } : null;
    })
    .filter((x): x is { n: number; f: string } => x !== null)
    .sort((a, b) => a.n - b.n)
    .map(({ f }) => publicUrl(`products/${folder}/${f}`));

  if (numbered.length > 0) return numbered;

  const out: string[] = [];
  for (let i = 1; i <= 8; i++) {
    for (const ext of ["jpg", "jpeg", "webp", "png"] as const) {
      const rel = `products/${folder}/${i}.${ext}`;
      if (fileExists(rel)) {
        out.push(publicUrl(rel));
        break;
      }
    }
  }
  return out.length > 0 ? out : fallback;
}

/**
 * Подставляет локальные файлы из `public/products/{speed|rainy|life}/`, если они есть.
 */
export function getCatalogDesignsWithImages(): CatalogDesign[] {
  return catalogDesignTemplates.map((d) => ({
    ...d,
    imageMain: resolveMainImage(d.id, d.imageMain),
    gallery: resolveGallery(d.id, d.gallery),
  }));
}
