import type { StudioOrder } from "@/lib/studio/db/schema";

/**
 * mode="full" (sheet orders) and mode="fair" (fair-event client bot) both run
 * the dog and text stages independently, tracked via dogStatus/textStatus,
 * and auto-start the final composition once both are approved.
 */
export function isParallelStageMode(mode: StudioOrder["mode"]): boolean {
  return mode === "full" || mode === "fair";
}

/**
 * Fair-event orders skip the automated LLM critique between generations —
 * the owner reviews every image by eye in Telegram anyway, and skipping the
 * critique call cuts both cost and wait time per customer at the event.
 */
export function skipsAutoCritique(mode: StudioOrder["mode"]): boolean {
  return mode === "fair";
}
