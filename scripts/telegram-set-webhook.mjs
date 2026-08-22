/**
 * node scripts/telegram-set-webhook.mjs [baseUrl]
 * node scripts/telegram-set-webhook.mjs --client [baseUrl]   -- fair-event client bot
 * Default baseUrl: OPS_PUBLIC_BASE_URL or https://dogood-brand.ru
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const isClient = process.argv[2] === "--client";
const baseArg = isClient ? process.argv[3] : process.argv[2];

const token = (isClient ? env.TELEGRAM_CLIENT_BOT_TOKEN : env.TELEGRAM_BOT_TOKEN)?.trim();
const secret = (isClient ? env.TELEGRAM_CLIENT_WEBHOOK_SECRET : env.TELEGRAM_WEBHOOK_SECRET)?.trim();
const base = (baseArg || env.OPS_PUBLIC_BASE_URL || "https://dogood-brand.ru").replace(/\/$/, "");

if (!token) {
  console.error(
    isClient ? "TELEGRAM_CLIENT_BOT_TOKEN missing in .env.local" : "TELEGRAM_BOT_TOKEN missing in .env.local",
  );
  process.exit(1);
}

const webhookUrl = `${base}${isClient ? "/api/telegram/client-webhook" : "/api/telegram/webhook"}`;
const params = new URLSearchParams({ url: webhookUrl });
if (secret) params.set("secret_token", secret);

const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook?${params}`).then((r) => r.json());
console.log("setWebhook:", JSON.stringify(set, null, 2));

const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());
console.log("getWebhookInfo:", JSON.stringify(info.result, null, 2));
