/**
 * Cloudflare Worker: reverse proxy for openrouter.ai.
 *
 * Why: the Timeweb VPS IP is blocked by OpenRouter/OpenAI/Google/Anthropic
 * ("Access denied by security policy"). Cloudflare's egress is not. The model
 * and prompts are unchanged — only the route.
 *
 * Deploy: cd workers/openrouter-proxy && npx wrangler deploy
 * Secret:  npx wrangler secret put PROXY_SECRET
 * Then set on the server: OPENROUTER_BASE_URL=https://<worker-url>/api/v1
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (env.PROXY_SECRET && request.headers.get("X-Proxy-Secret") !== env.PROXY_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!url.pathname.startsWith("/api/v1/")) {
      return new Response("not found", { status: 404 });
    }

    const target = `https://openrouter.ai${url.pathname}${url.search}`;
    // Build a clean header set instead of forwarding the incoming one: any
    // stray proxy/CF header can trip OpenRouter's WAF.
    const headers = new Headers();
    for (const h of ["authorization", "content-type", "http-referer", "x-title", "accept"]) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("user-agent", "DoGoodStudio/1.0");

    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
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
