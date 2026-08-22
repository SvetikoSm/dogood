/**
 * Одноразовый вход в «Мой налог» по СМС — без пароля.
 *
 *   node scripts/moy-nalog-sms-login.mjs
 *
 * Скрипт спросит номер телефона (тот, на который зарегистрирован «Мой налог»),
 * пришлёт СМС с кодом, попросит код — и сам запишет в .env.local три строки:
 * MOY_NALOG_INN, MOY_NALOG_REFRESH_TOKEN, MOY_NALOG_DEVICE_ID.
 * Токен долгоживущий: пока им пользуется сервер, он продлевается сам.
 * После скрипта запустите деплой, чтобы значения уехали на сервер.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import readline from "node:readline/promises";

const API = "https://lknpd.nalog.ru/api";

const deviceId = randomUUID().replace(/-/g, "").slice(0, 21);
const deviceInfo = {
  sourceDeviceId: deviceId,
  sourceType: "WEB",
  appVersion: "1.0.0",
  metaDetails: {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  },
};

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function upsertEnvLocal(pairs) {
  const envPath = resolve(process.cwd(), ".env.local");
  let content = readFileSync(envPath, "utf8");
  for (const [key, value] of Object.entries(pairs)) {
    const line = `${key}=${value}`;
    const active = new RegExp(`^${key}=.*$`, "m");
    const commented = new RegExp(`^#\\s*${key}=.*$`, "m");
    if (active.test(content)) content = content.replace(active, line);
    else if (commented.test(content)) content = content.replace(commented, line);
    else content += `${content.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  writeFileSync(envPath, content, "utf8");
  return envPath;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  const rawPhone = await rl.question("Номер телефона, на который зарегистрирован «Мой налог» (например +79001234567): ");
  const phone = rawPhone.replace(/[^\d]/g, "").replace(/^8/, "7");
  if (!/^7\d{10}$/.test(phone)) throw new Error(`Не похоже на российский номер: "${rawPhone}"`);

  console.log("Отправляю СМС с кодом...");
  const challenge = await post("/v2/auth/challenge/sms/start", {
    phone,
    requireTpToBeActive: true,
  });
  if (!challenge.challengeToken) throw new Error(`Ответ без challengeToken: ${JSON.stringify(challenge)}`);
  console.log(`СМС отправлена (код действует ~${challenge.expireIn ?? 120} секунд).`);

  const code = (await rl.question("Введите код из СМС: ")).trim();

  const auth = await post("/v2/auth/challenge/sms/verify", {
    phone,
    code,
    challengeToken: challenge.challengeToken,
    deviceInfo,
  });
  if (!auth.refreshToken) throw new Error(`Ответ без refreshToken: ${JSON.stringify(auth).slice(0, 400)}`);

  const inn = auth.profile?.inn ?? "";
  const name = auth.profile?.displayName ?? "";
  console.log(`\nВход выполнен: ${name || "(имя не пришло)"}, ИНН ${inn || "(не пришёл)"}`);

  const envPath = upsertEnvLocal({
    MOY_NALOG_INN: inn,
    MOY_NALOG_REFRESH_TOKEN: auth.refreshToken,
    MOY_NALOG_DEVICE_ID: deviceId,
  });
  console.log(`Записано в ${envPath}:`);
  console.log("  MOY_NALOG_INN, MOY_NALOG_REFRESH_TOKEN, MOY_NALOG_DEVICE_ID");
  console.log("\nГотово. Теперь запустите деплой: .\\scripts\\deploy-timeweb.ps1");
} catch (e) {
  console.error(`\nОшибка: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
