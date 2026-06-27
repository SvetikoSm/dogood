/**
 * Сжатие PNG/JPEG → WebP (аналог Squoosh, quality ~80).
 * Старые файлы не трогает — рядом появляется .webp с тем же именем.
 *
 * Запуск: node scripts/compress-public-images.mjs
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const SOURCE_RE = /\.(png|jpe?g)$/i;

/** Макс. ширина по типу файла */
function maxWidthFor(baseName) {
  if (baseName === "main" || baseName === "hero-person") return 1400;
  if (/^\d+$/.test(baseName)) return 1200;
  return 1000;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs)));
    } else if (SOURCE_RE.test(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

async function compressOne(absPath) {
  const dir = path.dirname(absPath);
  const ext = path.extname(absPath);
  const base = path.basename(absPath, ext);
  const outPath = path.join(dir, `${base}.webp`);

  const meta = await sharp(absPath).metadata();
  let img = sharp(absPath);
  const maxW = maxWidthFor(base);
  if (meta.width && meta.width > maxW) {
    img = img.resize(maxW, null, { withoutEnlargement: true });
  }

  await img.webp({ quality: 80, effort: 4 }).toFile(outPath);

  const before = (await stat(absPath)).size;
  const after = (await stat(outPath)).size;
  const rel = path.relative(PUBLIC_ROOT, absPath).replace(/\\/g, "/");
  const relOut = path.relative(PUBLIC_ROOT, outPath).replace(/\\/g, "/");
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  console.log(
    `${rel} → ${relOut}  ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB (−${pct}%)`,
  );
}

const files = await walk(PUBLIC_ROOT);
if (files.length === 0) {
  console.log("Нет PNG/JPEG в public/");
  process.exit(0);
}

console.log(`Сжимаем ${files.length} файлов…\n`);
for (const f of files) {
  await compressOne(f);
}
console.log("\nГотово. Старые файлы на месте — удалите вручную, когда проверите WebP.");
