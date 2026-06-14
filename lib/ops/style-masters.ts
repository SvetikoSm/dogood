import "server-only";

export type StyleSlug = "speed" | "life" | "rainy";

/** Имена файлов мастеров в папке Design references (как на Диске). */
export const STYLE_MASTER_FILE_LABEL: Record<StyleSlug, string> = {
  speed: "Design 1. I am speed",
  life: "Design 2. Life is better",
  rainy: "Design 3. No rainy days",
};

const STYLE_ALIASES: Record<string, StyleSlug> = {
  speed: "speed",
  life: "life",
  rainy: "rainy",
  "design 1": "speed",
  "design 2": "life",
  "design 3": "rainy",
  "i am speed": "speed",
  "life is better": "life",
  "no rainy days": "rainy",
  "я — скорость": "speed",
  "я - скорость": "speed",
  "я—скорость": "speed",
  "«я — скорость»": "speed",
  "«life is better»": "life",
  "«no rainy days»": "rainy",
};

function normalizeStyleKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/—/g, "-");
}

export function normalizeStyleId(raw: string): StyleSlug | null {
  const key = normalizeStyleKey(raw);
  if (!key) return null;
  if (STYLE_ALIASES[key]) return STYLE_ALIASES[key];
  if (key.includes("speed") || key.includes("скорост")) return "speed";
  if (key.includes("life") || key.includes("better")) return "life";
  if (key.includes("rainy") || key.includes("rain")) return "rainy";
  return null;
}

export function styleDisplayName(slug: StyleSlug): string {
  const map: Record<StyleSlug, string> = {
    speed: "«Я — скорость»",
    life: "«Life is better»",
    rainy: "«No rainy days»",
  };
  return map[slug];
}
