export type PetNameScript = "cyrillic" | "latin" | "mixed" | "other" | "unknown";

const CYR = /[\u0400-\u04FF]/;
const LAT = /[A-Za-z\u00C0-\u024F]/;

/** Classify script for UI hints only — generation always uses the raw string. */
export function inferPetNameScript(text: string): PetNameScript {
  const t = text.trim();
  if (!t) return "unknown";
  let c = 0;
  let l = 0;
  for (const ch of t) {
    if (CYR.test(ch)) c++;
    if (LAT.test(ch)) l++;
  }
  if (c && l) return "mixed";
  if (c) return "cyrillic";
  if (l) return "latin";
  return "other";
}
