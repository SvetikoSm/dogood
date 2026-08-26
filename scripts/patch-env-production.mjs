/**
 * Безопасно дописывает/обновляет ключи в .env.production (одна строка = одна переменная).
 *   node scripts/patch-env-production.mjs /opt/dogood/.env.production [path-to-sa.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function cacheBustId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

const BUST = cacheBustId();

const envPath = process.argv[2];
const saPath = process.argv[3];
const secretsPath = process.argv[4];

if (!envPath) {
  console.error("Usage: node patch-env-production.mjs <env-file> [sa.json] [secrets.env]");
  process.exit(1);
}

const REQUIRED = {
  GOOGLE_ORDER_WEBHOOK_URL:
    "https://script.google.com/macros/s/AKfycbzNftpTFFcCrtgQFcXKuomn-hOSm6VCu5-0YjyDy0qgTLg_U-Xk7QXjJbPaS26GfmioBA/exec",
  GOOGLE_ORDER_WEBHOOK_SECRET: "POPAPOPAPOPAPOPA",
  NEXT_PUBLIC_SITE_URL: "https://dogood-brand.ru",
  OPS_PUBLIC_BASE_URL: "https://dogood-brand.ru",
  GOOGLE_ORDER_DRIVE_FOLDER_ID: "1JZNyYuiAO-gdqRQp7pJ2vABMGR_mQHE7",
  GOOGLE_SHEETS_SPREADSHEET_ID: "1v0qR8kUcEICstHSo-R1yluzxarepLmL2B_cSTd1KN1Y",
  GOOGLE_SHEETS_TAB_NAME: "Orders",
  STUDIO_SHEET_PET_NAME_COLUMN: "Кличка",
  STUDIO_MOCK_AI: "false",
  STUDIO_IMAGE_MODEL: "openai/gpt-5.4-image-2",
  STUDIO_LLM_MODEL: "google/gemini-2.5-flash",
  // OpenRouter blocks Russian hosting IPs — route through a Hetzner proxy
  // (root@2.28.47.61, see docs/AI-EGRESS-FIX-PROMPT.md). Do not point this
  // back at https://openrouter.ai/api/v1 directly, it will 403 from this VPS.
  OPENROUTER_BASE_URL: "https://ai.dogood-brand.ru/api/v1",
  OPENROUTER_PROXY_SECRET: "c321f5dbc5ebceece8aafc570b7b5ccfbc2d1ea43aca096f",
  OPS_NOTIFY_TELEGRAM: "true",
  STUDIO_DRIVE_APPROVED_FOLDER_ID: "1-n0MWLhsxWG6_Rz9GMCp4LG9xYd2oiaQ",
  STUDIO_DRIVE_MOCKUP_FOLDER_ID: "1cqXzHfe1xByc1aFOlCZLbAGXyH-gISJ0",
  STUDIO_DRIVE_PET_REFS_FOLDER_ID: "1VcahlOwbGHCqK8iK3HULf4wENu2mTefq",
  STUDIO_DRIVE_TEXT_REFS_FOLDER_ID: "17K50Hx83nj4OBGgMLjM_8Qqzio1VXNqu",
  STUDIO_DRIVE_TEXT_BADGES_FOLDER_ID: "1eB9OI-KYKFb3s4LdiVBEnVOTwxSZGjtl",
  CACHE_BUST_ID: BUST,
  NEXT_PUBLIC_CACHE_BUST_ID: BUST,
};

let lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const map = new Map();

for (const line of lines) {
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  map.set(line.slice(0, eq), line.slice(eq + 1));
}

for (const [k, v] of Object.entries(REQUIRED)) {
  map.set(k, v);
}

if (saPath && existsSync(saPath)) {
  const json = JSON.parse(readFileSync(saPath, "utf8"));
  map.set("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify(json));
  console.log("SA:", json.client_email);
}

if (secretsPath && existsSync(secretsPath)) {
  for (const line of readFileSync(secretsPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) map.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  }
  console.log("Merged secrets from", secretsPath);
}

const out = [...map.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
writeFileSync(envPath, out, "utf8");
console.log("Patched", envPath, "keys:", [...map.keys()].join(", "));
