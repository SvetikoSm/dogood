import { defineConfig } from "drizzle-kit";

/** SQLite file used by the internal Studio dashboard (local or persistent disk). */
export default defineConfig({
  schema: "./lib/studio/db/schema.ts",
  out: "./lib/studio/db/generated-migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["STUDIO_DATABASE_URL"]?.trim() || "file:./data/studio/studio.db",
  },
});
