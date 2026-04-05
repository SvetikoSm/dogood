import "server-only";

/** Имена файлов мастеров в папке Design references (как на Диске). */
export const STYLE_MASTER_FILE_LABEL: Record<string, string> = {
  speed: "Design 1. I am speed",
  life: "Design 2. Life is better",
  rainy: "Design 3. No rainy days",
};

export function normalizeStyleId(raw: string): keyof typeof STYLE_MASTER_FILE_LABEL | null {
  const s = raw.trim().toLowerCase();
  if (s === "speed" || s === "life" || s === "rainy") return s;
  return null;
}
