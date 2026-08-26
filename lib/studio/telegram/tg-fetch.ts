import "server-only";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * fetch для api.telegram.org через curl.
 *
 * На Timeweb VPS Node TLS к api.telegram.org почти всегда даёт connect
 * ETIMEDOUT (DPI), а curl к тому же pinned IP проходит. Поэтому все ответы
 * бота (sendMessage / sendPhoto / getFile / …) уходят через curl.
 */
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
      // Trailing "\n{http_code}" from -w
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
  return new Response(body, {
    status: status || 502,
    headers: { "Content-Type": "application/json" },
  });
}

async function curlJson(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const args = ["-sS", "-m", "45", "-w", "\n%{http_code}", "-X", method];
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
    const args = ["-sS", "-m", "90", "-w", "\n%{http_code}", "-X", "POST"];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        // --form-string: do not interpret @/&lt; and keep JSON keyboards intact
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
        // FormData (sendPhoto) or other body types
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
