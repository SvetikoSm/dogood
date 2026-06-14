/**
 * One-shot local bootstrap: env + db + seed.
 * node scripts/studio-bootstrap.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const envPath = resolve(root, ".env.local");
const saPath = resolve(process.env.USERPROFILE || "", "Downloads/_sa-extracted.json");

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

function upsertEnv(path, patch) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const map = new Map();
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) map.set(line.slice(0, eq).trim(), line.slice(eq + 1));
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== "") map.set(k, v);
  }
  writeFileSync(path, [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n", "utf8");
}

const env = loadEnv(envPath);
const patch = {
  GOOGLE_SHEETS_SPREADSHEET_ID: "1v0qR8kUcEICstHSo-R1yluzxarepLmL2B_cSTd1KN1Y",
  GOOGLE_SHEETS_TAB_NAME: "DOGOOD",
  STUDIO_SHEET_PET_NAME_COLUMN: "Кличка",
  GOOGLE_ORDER_DRIVE_FOLDER_ID: "1JZNyYuiAO-gdqRQp7pJ2vABMGR_mQHE7",
  OPS_PUBLIC_BASE_URL: "https://dogood-brand.ru",
  NEXT_PUBLIC_SITE_URL: "https://dogood-brand.ru",
  STUDIO_IMAGE_MODEL: "google/gemini-3-pro-image-preview",
  STUDIO_LLM_MODEL: "google/gemini-2.5-flash-preview-05-20",
  STUDIO_MOCK_AI: "false",
};

if (!env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY) {
  patch.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
} else if (!env.OPENROUTER_API_KEY) {
  console.warn("OPENROUTER_API_KEY not set — add it to .env.local or export it before bootstrap.");
}

if (existsSync(saPath)) {
  const sa = JSON.parse(readFileSync(saPath, "utf8"));
  patch.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(sa);
  console.log("SA:", sa.client_email);
}

upsertEnv(envPath, patch);
console.log("Updated .env.local");

execSync("npm run studio:db:push", { stdio: "inherit", cwd: root });
execSync("npm run studio:seed", { stdio: "inherit", cwd: root });
console.log("DB ready.");
