/**
 * Adds orchestrator retry columns + lock table (2026-07).
 * Safe to run repeatedly; uses ALTER TABLE (no table recreate) so it is
 * also the migration to run on the VPS against live data:
 *
 *   node scripts/studio-migrate-2026-07-retry.mjs
 */
import { createClient } from "@libsql/client";

const url = process.env.STUDIO_DATABASE_URL?.trim() || "file:data/studio/studio.db";
const c = createClient({ url });

const cols = await c.execute("pragma table_info('studio_orders')");
const names = cols.rows.map((r) => r.name);

if (!names.includes("retry_count")) {
  await c.execute(
    "ALTER TABLE studio_orders ADD COLUMN retry_count integer NOT NULL DEFAULT 0",
  );
  console.log("added studio_orders.retry_count");
}
if (!names.includes("next_retry_at")) {
  await c.execute("ALTER TABLE studio_orders ADD COLUMN next_retry_at integer");
  console.log("added studio_orders.next_retry_at");
}
if (!names.includes("mode")) {
  await c.execute("ALTER TABLE studio_orders ADD COLUMN mode text NOT NULL DEFAULT 'full'");
  console.log("added studio_orders.mode");
}

await c.execute(
  `CREATE TABLE IF NOT EXISTS studio_tg_sessions (
     chat_id text PRIMARY KEY NOT NULL,
     flow text NOT NULL DEFAULT '',
     style text NOT NULL DEFAULT '',
     awaiting text NOT NULL DEFAULT '',
     order_id text NOT NULL DEFAULT '',
     updated_at integer NOT NULL DEFAULT (unixepoch())
   )`,
);
console.log("ensured studio_tg_sessions");
await c.execute(
  "CREATE TABLE IF NOT EXISTS studio_locks (name text PRIMARY KEY NOT NULL, locked_until integer NOT NULL)",
);
console.log("ensured studio_locks");

await c.execute(
  `CREATE TABLE IF NOT EXISTS studio_ai_calls (
     id text PRIMARY KEY NOT NULL,
     order_id text NOT NULL DEFAULT '',
     step_key text NOT NULL DEFAULT '',
     kind text NOT NULL DEFAULT 'llm',
     model text NOT NULL DEFAULT '',
     prompt_tokens integer NOT NULL DEFAULT 0,
     completion_tokens integer NOT NULL DEFAULT 0,
     total_tokens integer NOT NULL DEFAULT 0,
     cost_usd real NOT NULL DEFAULT 0,
     created_at integer NOT NULL DEFAULT (unixepoch())
   )`,
);
await c.execute(
  "CREATE INDEX IF NOT EXISTS studio_ai_calls_order_idx ON studio_ai_calls (order_id)",
);
console.log("ensured studio_ai_calls");

const check = await c.execute("pragma table_info('studio_orders')");
console.log("studio_orders columns:", check.rows.map((r) => r.name).join(", "));
c.close();
