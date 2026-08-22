/**
 * Server-side Telegram poller for BOTH bots (owner review bot + fair client bot).
 *
 * Why: Telegram's datacenters cannot open inbound connections to this VPS
 * (webhooks fail with "Connection timed out"), while outbound calls from the
 * VPS to api.telegram.org work fine. So instead of webhooks we long-poll
 * getUpdates here and forward each update to the local Next.js app — the
 * same routes the webhooks would have hit, so all bot logic stays in one place.
 *
 * Runs on the VPS host as a systemd service (see install-telegram-poller.sh):
 *   node scripts/telegram-server-poller.mjs /opt/dogood/.env.production
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const envPath = process.argv[2] || "/opt/dogood/.env.production";
const APP = "http://127.0.0.1:3000";
const OFFSETS_FILE = "/opt/dogood/.tg-poller-offsets.json";

const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const bots = [];
if (env.TELEGRAM_BOT_TOKEN) {
  bots.push({
    name: "owner",
    token: env.TELEGRAM_BOT_TOKEN,
    secret: env.TELEGRAM_WEBHOOK_SECRET || "",
    route: "/api/telegram/webhook",
  });
}
if (env.TELEGRAM_CLIENT_BOT_TOKEN) {
  bots.push({
    name: "client",
    token: env.TELEGRAM_CLIENT_BOT_TOKEN,
    secret: env.TELEGRAM_CLIENT_WEBHOOK_SECRET || "",
    route: "/api/telegram/client-webhook",
  });
}
if (!bots.length) {
  console.error("[poller] no bot tokens in", envPath);
  process.exit(1);
}

let offsets = {};
try {
  if (existsSync(OFFSETS_FILE)) offsets = JSON.parse(readFileSync(OFFSETS_FILE, "utf8"));
} catch {
  offsets = {};
}
function saveOffsets() {
  try {
    writeFileSync(OFFSETS_FILE, JSON.stringify(offsets), "utf8");
  } catch (e) {
    console.error("[poller] offsets save failed:", e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(bot, method, params = "") {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 40_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/${method}${params}`, {
      signal: controller.signal,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(t);
  }
}

/** POST one update into the local app; retry until the app accepts it. */
async function forward(bot, update) {
  for (;;) {
    try {
      const res = await fetch(`${APP}${bot.route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": bot.secret,
        },
        body: JSON.stringify(update),
      });
      if (res.ok) return;
      // 401/400/503 are app-level verdicts, not transient — do not retry forever.
      console.error(`[poller:${bot.name}] app answered ${res.status} for update ${update.update_id}`);
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return;
    } catch (e) {
      console.error(`[poller:${bot.name}] forward failed (${e.message}), app down? retrying...`);
    }
    await sleep(5000);
  }
}

async function pollLoop(bot) {
  // getUpdates conflicts with an active webhook — remove it first.
  try {
    await tg(bot, "deleteWebhook", "?drop_pending_updates=false");
    console.log(`[poller:${bot.name}] webhook removed, polling started`);
  } catch (e) {
    console.error(`[poller:${bot.name}] deleteWebhook failed:`, e.message);
  }

  for (;;) {
    try {
      const offset = offsets[bot.name] ? `&offset=${offsets[bot.name]}` : "";
      const r = await tg(bot, "getUpdates", `?timeout=25${offset}`);

      if (r.status === 409) {
        // Another consumer (stray webhook or second poller) — reclaim and go on.
        await tg(bot, "deleteWebhook", "?drop_pending_updates=false");
        await sleep(3000);
        continue;
      }
      if (!r.body?.ok) {
        console.error(`[poller:${bot.name}] getUpdates ${r.status}:`, JSON.stringify(r.body)?.slice(0, 200));
        await sleep(5000);
        continue;
      }

      for (const update of r.body.result) {
        await forward(bot, update);
        offsets[bot.name] = update.update_id + 1;
        saveOffsets();
      }
    } catch (e) {
      console.error(`[poller:${bot.name}] loop error:`, e.message);
      await sleep(5000);
    }
  }
}

console.log(`[poller] starting for: ${bots.map((b) => b.name).join(", ")} (node ${process.version})`);
for (const bot of bots) void pollLoop(bot);
