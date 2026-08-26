import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { telegramHttpsProxy } from "@/lib/studio/telegram/api-base";

/**
 * fetch для Telegram Bot API через curl.
 *
 * На Timeweb VPS прямой TLS к api.telegram.org часто даёт connect ETIMEDOUT
 * (DPI). Решение: Cloudflare WARP в режиме локального HTTP-прокси
 * (TELEGRAM_HTTPS_PROXY=http://172.17.0.1:40000 внутри Docker) — curl -x
 * ходит через WARP, и Telegram стабильно доступен без ПК-релея.
 *
 * Альтернатива: TELEGRAM_API_BASE на Cloudflare Worker
 * (workers/telegram-api-proxy), тогда прокси не обязателен.
 */
function proxyArgs(): string[] {
  const proxy = telegramHttpsProxy();
  return proxy ? ["-x", proxy] : [];
}

function curlOnce(args: string[], timeoutMs: number): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("tgFetch: curl timeout"));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const text = buf.toString("binary");
      const nl = text.lastIndexOf("\n");
      if (nl < 0) {
        reject(new Error(err.trim() || `curl exit ${code}`));
        return;
      }
      const status = Number(text.slice(nl + 1)) || 0;
      const body = Buffer.from(text.slice(0, nl), "binary");
      if (!status && code !== 0) {
        reject(new Error(err.trim() || `curl exit ${code}`));
        return;
      }
      resolve({ status, body });
    });
  });
}

function toResponse(status: number, body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    status: status || 502,
    headers: { "Content-Type": "application/json" },
  });
}

async function curlJson(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const args = ["-sS", "-m", "45", ...proxyArgs(), "-w", "\n%{http_code}", "-X", method];
  const headers = init?.headers;
  if (headers) {
    const h = headers instanceof Headers ? headers : new Headers(headers as HeadersInit);
    h.forEach((v, k) => {
      args.push("-H", `${k}: ${v}`);
    });
  }
  if (init?.body != null && typeof init.body === "string") {
    args.push("--data-binary", init.body);
  }
  args.push(url);
  const { status, body } = await curlOnce(args, 50_000);
  return toResponse(status, body);
}

async function curlFormData(url: string, form: FormData): Promise<Response> {
  const dir = await mkdtemp(path.join(tmpdir(), "tg-form-"));
  try {
    const args = ["-sS", "-m", "90", ...proxyArgs(), "-w", "\n%{http_code}", "-X", "POST"];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        args.push("--form-string", `${key}=${value}`);
      } else {
        const blob = value as File;
        const buf = Buffer.from(await blob.arrayBuffer());
        const filename = blob.name || "photo.png";
        const tmp = path.join(dir, `${randomBytes(4).toString("hex")}-${filename}`);
        await writeFile(tmp, buf);
        const type = blob.type || "application/octet-stream";
        args.push("-F", `${key}=@${tmp};filename=${filename};type=${type}`);
      }
    }
    args.push(url);
    const { status, body } = await curlOnce(args, 100_000);
    return toResponse(status, body);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function tgFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (init?.body && typeof init.body !== "string" && !(init.body instanceof ArrayBuffer)) {
        if (typeof FormData !== "undefined" && init.body instanceof FormData) {
          return await curlFormData(url, init.body);
        }
      }
      return await curlJson(url, init);
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}
