import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { CatalogDesign } from "@/lib/landing-data";
import { catalogDesignTemplates } from "@/lib/landing-data";

const PUBLIC_ROOT = path.join(process.cwd(), "public");

const IMAGE_EXTS = ["webp", "jpg", "jpeg", "png"] as const;
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

function extPriority(ext: string): number {
  const i = IMAGE_EXTS.indexOf(ext.toLowerCase() as (typeof IMAGE_EXTS)[number]);
  return i === -1 ? 99 : i;
}

/** main/cover: предпочитаем .webp, если лежит рядом с .png/.jpg */
function resolveMainImage(folder: string, fallback: string): string {
  for (const stem of ["main", "cover"]) {
    for (const ext of IMAGE_EXTS) {
      const rel = `products/${folder}/${stem}.${ext}`;
      if (fileExists(rel)) return publicUrl(rel);
    }
  }
  return fallback;
}

/** Галерея 1..8: на каждый номер — один файл, предпочитаем .webp */
function resolveGallery(folder: string, fallback: string[]): string[] {
  const files = listProductDir(folder);
  const bestByNum = new Map<number, string>();

  for (const f of files) {
    const m = f.match(GALLERY_RE);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    const ext = m[2]!.toLowerCase().replace("jpeg", "jpg");
    const prev = bestByNum.get(n);
    if (!prev) {
      bestByNum.set(n, f);
      continue;
    }
    const prevExt = prev.split(".").pop()!.toLowerCase().replace("jpeg", "jpg");
    if (extPriority(ext) < extPriority(prevExt)) {
      bestByNum.set(n, f);
    }
  }

  if (bestByNum.size > 0) {
    return [...bestByNum.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, file]) => publicUrl(`products/${folder}/${file}`));
  }

  const out: string[] = [];
  for (let i = 1; i <= 8; i++) {
    for (const ext of IMAGE_EXTS) {
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
