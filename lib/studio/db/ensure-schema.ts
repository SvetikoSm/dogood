import "server-only";

import type { Client } from "@libsql/client";

import { getStudioRawClient } from "./index";

/**
 * Create/upgrade the Studio SQLite schema at runtime, idempotently.
 *
 * Production runs the Next.js standalone image, which does NOT contain
 * drizzle-kit (a devDependency), so `drizzle-kit push` cannot create tables on
 * the server. Instead the app ensures its own schema on first use via the
 * runtime libsql client. Keep this in sync with `schema.ts`.
 */
let ready: Promise<void> | null = null;

export function ensureStudioSchema(): Promise<void> {
  if (!ready) {
    ready = doEnsure().catch((e) => {
      ready = null; // allow retry on next call
      throw e;
    });
  }
  return ready;
}

const DDL = `
CREATE TABLE IF NOT EXISTS studio_templates (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  design_template_path text NOT NULL,
  pet_style_ref_paths_json text NOT NULL DEFAULT '[]',
  text_style_ref_path text NOT NULL,
  replacement_rules_json text NOT NULL,
  composition_notes text NOT NULL DEFAULT '',
  created_at integer NOT NULL DEFAULT (unixepoch()),
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS studio_templates_slug_idx ON studio_templates (slug);

CREATE TABLE IF NOT EXISTS studio_orders (
  id text PRIMARY KEY NOT NULL,
  sheet_order_id text NOT NULL UNIQUE,
  customer_name text NOT NULL DEFAULT '',
  pet_name_raw text NOT NULL DEFAULT '',
  pet_name_script text NOT NULL DEFAULT 'unknown',
  design_slug text NOT NULL DEFAULT '',
  drive_folder_url text NOT NULL DEFAULT '',
  drive_folder_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  mode text NOT NULL DEFAULT 'full',
  dog_status text NOT NULL DEFAULT 'pending',
  text_status text NOT NULL DEFAULT 'pending',
  dog_notified integer NOT NULL DEFAULT 0,
  text_notified integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  approved_dog_artifact_path text NOT NULL DEFAULT '',
  approved_text_artifact_path text NOT NULL DEFAULT '',
  approved_final_artifact_path text NOT NULL DEFAULT '',
  review_notified_for text NOT NULL DEFAULT '',
  human_reject_note text NOT NULL DEFAULT '',
  text_reject_note text NOT NULL DEFAULT '',
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at integer,
  sheet_payload_json text NOT NULL DEFAULT '{}',
  created_at integer NOT NULL DEFAULT (unixepoch()),
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS studio_orders_status_idx ON studio_orders (status);
CREATE INDEX IF NOT EXISTS studio_orders_design_idx ON studio_orders (design_slug);

CREATE TABLE IF NOT EXISTS studio_order_photos (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  drive_file_id text NOT NULL DEFAULT '',
  original_name text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  local_relative_path text NOT NULL DEFAULT '',
  created_at integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS studio_order_photos_order_idx ON studio_order_photos (order_id);

CREATE TABLE IF NOT EXISTS studio_step_runs (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL,
  stage text NOT NULL,
  step_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  provider_llm text NOT NULL DEFAULT '',
  provider_image text NOT NULL DEFAULT '',
  llm_model text NOT NULL DEFAULT '',
  image_model text NOT NULL DEFAULT '',
  input_snapshot_json text NOT NULL DEFAULT '{}',
  prompt_bundle_json text NOT NULL DEFAULT '{}',
  llm_output_json text NOT NULL DEFAULT '',
  output_artifact_path text NOT NULL DEFAULT '',
  raw_llm_response_text text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  parent_step_run_id text NOT NULL DEFAULT '',
  started_at integer,
  finished_at integer,
  created_at integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS studio_step_runs_order_idx ON studio_step_runs (order_id);
CREATE INDEX IF NOT EXISTS studio_step_runs_order_step_idx ON studio_step_runs (order_id, step_key);

CREATE TABLE IF NOT EXISTS studio_locks (
  name text PRIMARY KEY NOT NULL,
  locked_until integer NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_ai_calls (
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
);
CREATE INDEX IF NOT EXISTS studio_ai_calls_order_idx ON studio_ai_calls (order_id);

CREATE TABLE IF NOT EXISTS studio_tg_sessions (
  chat_id text PRIMARY KEY NOT NULL,
  flow text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  awaiting text NOT NULL DEFAULT '',
  order_id text NOT NULL DEFAULT '',
  updated_at integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS studio_prompt_definitions (
  key text PRIMARY KEY NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  updated_at integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS studio_fair_orders (
  id text PRIMARY KEY NOT NULL,
  order_id text NOT NULL,
  chat_id text NOT NULL,
  step text NOT NULL DEFAULT 'awaiting_photo',
  pet_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  makeup_url text NOT NULL DEFAULT '',
  payment_id text NOT NULL DEFAULT '',
  payment_status text NOT NULL DEFAULT '',
  payment_url text NOT NULL DEFAULT '',
  amount_rub text NOT NULL DEFAULT '',
  size text NOT NULL DEFAULT '',
  fio text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  delivery_service text NOT NULL DEFAULT '',
  pvz text NOT NULL DEFAULT '',
  sheet_row_written integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL DEFAULT (unixepoch()),
  updated_at integer NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS studio_fair_orders_chat_idx ON studio_fair_orders (chat_id);
CREATE INDEX IF NOT EXISTS studio_fair_orders_order_idx ON studio_fair_orders (order_id);
CREATE INDEX IF NOT EXISTS studio_fair_orders_payment_idx ON studio_fair_orders (payment_id);

CREATE TABLE IF NOT EXISTS studio_review_pending (
  chat_id text PRIMARY KEY NOT NULL,
  stage text NOT NULL,
  sheet_order_id text NOT NULL,
  updated_at integer NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS studio_lane_state (
  order_id text NOT NULL,
  stage text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at integer,
  last_error text NOT NULL DEFAULT '',
  updated_at integer NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (order_id, stage)
);
`;

async function addColumnIfMissing(c: Client, table: string, col: string, def: string) {
  const info = await c.execute(`pragma table_info('${table}')`);
  const has = info.rows.some((r) => String(r.name) === col);
  if (!has) await c.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

/**
 * Backfill dogStatus/textStatus for rows written before those columns
 * existed, so an in-flight mode="full" order isn't silently reprocessed
 * from scratch when it starts using the new independent dog/text tracking.
 * Every UPDATE only touches rows still at the column's default, so this is
 * safe (and cheap) to run unconditionally on every ensure call.
 */
async function backfillFullOrderStageStatus(c: Client): Promise<void> {
  await c.executeMultiple(`
    UPDATE studio_orders SET dog_status = 'approved'
      WHERE mode = 'full' AND dog_status = 'pending' AND approved_dog_artifact_path <> '';
    UPDATE studio_orders SET dog_status = 'awaiting_approval'
      WHERE mode = 'full' AND dog_status = 'pending' AND status = 'dog_awaiting_approval';
    UPDATE studio_orders SET dog_status = 'in_progress'
      WHERE mode = 'full' AND dog_status = 'pending' AND status = 'dog_in_progress';
    UPDATE studio_orders SET text_status = 'approved'
      WHERE mode = 'full' AND text_status = 'pending' AND approved_text_artifact_path <> '';
    UPDATE studio_orders SET text_status = 'awaiting_approval'
      WHERE mode = 'full' AND text_status = 'pending' AND status = 'text_awaiting_approval';
    UPDATE studio_orders SET text_status = 'in_progress'
      WHERE mode = 'full' AND text_status = 'pending' AND status = 'text_in_progress';
    UPDATE studio_orders SET status = 'in_progress'
      WHERE mode = 'full' AND status IN (
        'dog_in_progress', 'dog_awaiting_approval', 'dog_approved_idle',
        'text_in_progress', 'text_awaiting_approval'
      );
  `);
}

async function doEnsure(): Promise<void> {
  const c = getStudioRawClient();
  // Concurrent lanes write to SQLite at the same time: WAL lets readers and a
  // writer coexist, and busy_timeout makes a contended write wait instead of
  // failing outright with SQLITE_BUSY.
  try {
    await c.execute("PRAGMA journal_mode=WAL");
    await c.execute("PRAGMA busy_timeout=10000");
  } catch (e) {
    console.error("[ensure-schema] pragma setup", e);
  }
  await c.executeMultiple(DDL);
  // Columns added after the original schema — patch older databases in place.
  await addColumnIfMissing(c, "studio_orders", "mode", "text NOT NULL DEFAULT 'full'");
  await addColumnIfMissing(c, "studio_orders", "retry_count", "integer NOT NULL DEFAULT 0");
  await addColumnIfMissing(c, "studio_orders", "next_retry_at", "integer");
  await addColumnIfMissing(c, "studio_orders", "dog_status", "text NOT NULL DEFAULT 'pending'");
  await addColumnIfMissing(c, "studio_orders", "text_status", "text NOT NULL DEFAULT 'pending'");
  await addColumnIfMissing(c, "studio_orders", "dog_notified", "integer NOT NULL DEFAULT 0");
  await addColumnIfMissing(c, "studio_orders", "text_notified", "integer NOT NULL DEFAULT 0");
  await addColumnIfMissing(c, "studio_orders", "text_reject_note", "text NOT NULL DEFAULT ''");
  await backfillFullOrderStageStatus(c);
}
