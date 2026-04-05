import "server-only";

export function isGenerationDryRun(): boolean {
  const v = process.env.GENERATION_DRY_RUN?.trim().toLowerCase();
  if (!v) return true;
  return !["0", "false", "no", "off"].includes(v);
}
