import "server-only";

import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { ensureStudioDirs, getStudioDataDir } from "@/lib/studio/paths";
import { getEnvRaw } from "@/lib/studio/runtime-env";

import * as schema from "./schema";

export type StudioDb = LibSQLDatabase<typeof schema>;

let _client: Client | null = null;
let _db: StudioDb | null = null;

function studioDatabaseUrl(): string {
  const env = getEnvRaw("STUDIO_DATABASE_URL")?.trim();
  if (env) return env;
  const full = path.join(getStudioDataDir(), "studio.db");
  return `file:${full.replace(/\\/g, "/")}`;
}

export function getStudioDb(): StudioDb {
  if (_db) return _db;
  ensureStudioDirs();
  const url = studioDatabaseUrl();
  _client = createClient({ url });
  _db = drizzle(_client, { schema });
  return _db;
}

export { schema };
