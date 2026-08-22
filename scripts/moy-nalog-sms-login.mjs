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
import net from "node:net";
import { resolve } from "node:path";
import readline from "node:readline/promises";
import https from "node:https";
import tls from "node:tls";

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

// lknpd.nalog.ru sits behind DPI that blocks Node's TLS ClientHello on
// connect (fetch/https.request both hang and time out), while curl and
// browsers reach the same IP fine. Splitting the first TLS record into two
// small TCP writes defeats simple SNI-matching DPI. See lib/payments/dpi-safe-fetch.ts
// for the same trick used by the deployed app.
class FragmentedHelloAgent extends https.Agent {
  createConnection(options, callback) {
    const socket = net.connect({ host: options.host, port: options.port ?? 443 });
    socket.setNoDelay(true);
    let helloSent = false;
    const rawWrite = socket.write.bind(socket);
    socket.write = (data, encoding, cb) => {
      if (!helloSent && Buffer.isBuffer(data) && data.length > 20) {
        helloSent = true;
        rawWrite(data.subarray(0, 5));
        return rawWrite(data.subarray(5), encoding, cb);
      }
      return rawWrite(data, encoding, cb);
    };
    const tlsSocket = tls.connect({ socket, servername: options.servername ?? options.host });
    if (callback) {
      tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
      tlsSocket.once("error", (err) => callback(err));
    }
    return tlsSocket;
  }
}
const dpiSafeAgent = new FragmentedHelloAgent({ keepAlive: false });

async function dpiSafeFetch(url, init = {}) {
  const u = new URL(url);
  const bodyBuf = init.body !== undefined ? Buffer.from(init.body) : undefined;
  return new Promise((resolvePromise, reject) => {
    const req = https.request(
      {
        agent: dpiSafeAgent,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers: { ...(bodyBuf ? { "Content-Length": String(bodyBuf.length) } : {}), ...init.headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolvePromise({
            ok: status >= 200 && status < 300,
            status,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.socket?.on("error", () => {});
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function post(path, body) {
  const res = await dpiSafeFetch(`${API}${path}`, {
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

  // start is /v2/..., verify is /v1/... — confirmed against the official
  // lknpd clients (tolikproh/npd, mityayka1/lknpd-nalog-api-ts).
  const auth = await post("/v1/auth/challenge/sms/verify", {
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
