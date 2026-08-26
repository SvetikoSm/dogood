/**
 * Server-side Telegram poller for BOTH bots (owner + fair client).
 *
 * Why polling: Telegram cannot open inbound connections to this VPS (webhooks
 * time out). Why curl: the provider DPI blackholes most Node TLS connects to
 * api.telegram.org (connect ETIMEDOUT), while curl to the same pinned IP works
 * reliably. So getUpdates/deleteWebhook go through curl; each update is then
 * POSTed to the local Next.js webhook routes.
 *
 *   node scripts/telegram-server-poller.mjs /opt/dogood/.env.production
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

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

/** curl → Telegram Bot API. Long-poll getUpdates needs a >25s timeout. */
function curlJson(url, { timeoutSec = 40 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      ["-sS", "-m", String(timeoutSec), "-w", "\n%{http_code}", url],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !out) {
        reject(new Error(err.trim() || `curl exit ${code}`));
        return;
      }
      const nl = out.lastIndexOf("\n");
      const bodyText = nl >= 0 ? out.slice(0, nl) : out;
      const status = Number(nl >= 0 ? out.slice(nl + 1) : 0) || 0;
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = null;
      }
      resolve({ status, body });
    });
  });
}

async function tg(bot, method, params = "") {
  const url = `https://api.telegram.org/bot${bot.token}/${method}${params}`;
  // getUpdates long-polls ~25s server-side
  const timeoutSec = method === "getUpdates" ? 40 : 20;
  return curlJson(url, { timeoutSec });
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
      console.error(`[poller:${bot.name}] app answered ${res.status} for update ${update.update_id}`);
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return;
    } catch (e) {
      console.error(`[poller:${bot.name}] forward failed (${e.message}), app down? retrying...`);
    }
    await sleep(5000);
  }
}

async function pollLoop(bot) {
  try {
    await tg(bot, "deleteWebhook", "?drop_pending_updates=false");
    console.log(`[poller:${bot.name}] webhook removed, polling via curl`);
  } catch (e) {
    console.error(`[poller:${bot.name}] deleteWebhook failed:`, e.message);
  }

  for (;;) {
    try {
      const offset = offsets[bot.name] ? `&offset=${offsets[bot.name]}` : "";
      const r = await tg(bot, "getUpdates", `?timeout=25${offset}`);

      if (r.status === 409) {
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

console.log(`[poller] starting for: ${bots.map((b) => b.name).join(", ")} (curl→api.telegram.org)`);
for (const bot of bots) void pollLoop(bot);
