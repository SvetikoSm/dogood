import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeStyleId } from "@/lib/ops/style-masters";

export async function loadPrimaryGenerationPrompt(styleIdRaw: string): Promise<string> {
  const id = normalizeStyleId(styleIdRaw) ?? "speed";
  const base = path.join(process.cwd(), "prompts", "generation", `primary-${id}.txt`);
  try {
    return (await readFile(base, "utf-8")).trim();
  } catch {
    const fallback = path.join(process.cwd(), "prompts", "generation", "primary-speed.txt");
    return (await readFile(fallback, "utf-8")).trim();
  }
}
