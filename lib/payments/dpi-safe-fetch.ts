import "server-only";

import type { Duplex } from "node:stream";
import type { ClientRequestArgs } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/**
 * lknpd.nalog.ru («Мой налог») sits behind DPI that blocks Node's TLS client
 * on connect: both the global fetch (undici) and a plain https.request hang
 * for ~10s and time out, while curl and browsers reach the same IP instantly.
 * Splitting the first TLS record (ClientHello, which carries the plaintext
 * SNI) into two small TCP writes defeats simple SNI-matching DPI — the same
 * trick used by GoodbyeDPI-style tools. Confirmed against the real API:
 * a plain https.request to this host times out on connect, the fragmented
 * version completes the handshake and gets a real HTTP response.
 *
 * Scoped to this one host only — every other integration in the app (ЮKassa,
 * OpenRouter, Google, Telegram) keeps using the normal global fetch.
 */
class FragmentedHelloAgent extends https.Agent {
  createConnection(
    options: ClientRequestArgs,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex {
    const host = String(options.host ?? "");
    const port = Number(options.port ?? 443);
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);

    let helloSent = false;
    const rawWrite = socket.write.bind(socket);
    socket.write = ((data: unknown, encoding?: unknown, cb?: unknown) => {
      if (!helloSent && Buffer.isBuffer(data) && data.length > 20) {
        helloSent = true;
        rawWrite(data.subarray(0, 5));
        return rawWrite(data.subarray(5), encoding as BufferEncoding, cb as () => void);
      }
      return rawWrite(data as Buffer, encoding as BufferEncoding, cb as () => void);
    }) as typeof socket.write;

    const servername = (options as { servername?: string }).servername ?? host;
    const tlsSocket = tls.connect({ socket, servername });
    if (callback) {
      tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
      tlsSocket.once("error", (err) => callback(err, tlsSocket));
    }
    return tlsSocket;
  }
}

const agent = new FragmentedHelloAgent({ keepAlive: false });

export type DpiSafeResponse = { ok: boolean; status: number; text: () => Promise<string> };

/** Minimal fetch-like helper for lknpd.nalog.ru only — see class doc above. */
export async function dpiSafeFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<DpiSafeResponse> {
  const u = new URL(url);
  const bodyBuf = init.body !== undefined ? Buffer.from(init.body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        agent,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? "GET",
        headers: {
          ...(bodyBuf ? { "Content-Length": String(bodyBuf.length) } : {}),
          ...init.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          });
        });
        // The DPI middlebox occasionally injects a stray record after the
        // real response goes through — swallow socket errors post-response
        // instead of crashing an already-settled request.
        res.socket?.on("error", () => {});
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("dpiSafeFetch: timeout")));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}
