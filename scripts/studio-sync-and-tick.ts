/**
 * npx tsx scripts/studio-sync-and-tick.ts
 */
import { syncStudioTemplatesFromDrive } from "../lib/studio/google/sync-templates-from-drive";
import { syncStudioOrdersFromGoogleSheet } from "../lib/studio/google/sync-orders-from-sheet";
import { runStudioPipelineTick } from "../lib/studio/pipeline/orchestrator";

async function main() {
  console.log("1) Sync templates from Drive...");
  console.log(await syncStudioTemplatesFromDrive());

  console.log("2) Sync orders from sheet...");
  console.log(await syncStudioOrdersFromGoogleSheet());

  console.log("3) Pipeline tick...");
  console.log(await runStudioPipelineTick());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
