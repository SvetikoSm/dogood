/**
 * Read TELEGRAM_BOT_TOKEN from .env.local and print chat id hints.
 * 1) Message your bot in Telegram first
 * 2) node scripts/telegram-get-chat-id.mjs
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

const token = env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN missing in .env.local");
  process.exit(1);
}

const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
if (!me.ok) {
  console.error("getMe failed:", me);
  process.exit(1);
}
console.log("Bot OK:", me.result.username);

const updates = await fetch(`https://api.telegram.org/bot${token}/getUpdates`).then((r) => r.json());
if (!updates.ok) {
  console.error("getUpdates failed:", updates);
  process.exit(1);
}

const chats = new Map();
for (const u of updates.result ?? []) {
  const c = u.message?.chat;
  if (c?.id) chats.set(c.id, { id: c.id, type: c.type, title: c.title, username: c.username, first_name: c.first_name });
}

if (!chats.size) {
  console.log("\nNo messages yet. Open Telegram, find @" + me.result.username + ", send any text, run this script again.");
  process.exit(0);
}

console.log("\nPut one of these in .env.local as TELEGRAM_CHAT_ID:\n");
for (const c of chats.values()) {
  console.log(`TELEGRAM_CHAT_ID=${c.id}  (${c.type}${c.username ? " @" + c.username : ""}${c.first_name ? " " + c.first_name : ""})`);
}
