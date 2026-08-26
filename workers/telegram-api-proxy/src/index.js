/**
 * Cloudflare Worker: reverse proxy for api.telegram.org.
 *
 * Why: Timeweb VPS cannot open stable TLS to Telegram (DPI). The VPS can
 * reach Cloudflare; Cloudflare can reach Telegram. Point TELEGRAM_API_BASE
 * at this worker URL (no trailing slash).
 *
 * Deploy (once, from a machine with wrangler logged in):
 *   cd workers/telegram-api-proxy && npx wrangler deploy
 *
 * Optional secret (recommended): PROXY_SECRET — then callers must send
 *   X-Tg-Proxy-Secret: <value>
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (env.PROXY_SECRET) {
      const got = request.headers.get("X-Tg-Proxy-Secret") || "";
      if (got !== env.PROXY_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    // Allow /botTOKEN/... and /file/botTOKEN/...
    if (!url.pathname.startsWith("/bot") && !url.pathname.startsWith("/file/")) {
      return new Response("not found", { status: 404 });
    }

    const target = new URL(`https://api.telegram.org${url.pathname}${url.search}`);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ray");
    headers.delete("x-tg-proxy-secret");

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      // @ts-expect-error duplex needed for streaming body in Workers
      init.duplex = "half";
    }

    const res = await fetch(target, init);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  },
};
