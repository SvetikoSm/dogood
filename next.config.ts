import type { NextConfig } from "next";

const onNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  /** HEIC→JPEG на сервере (`heic-convert`); не бандлить в webpack. */
  serverExternalPackages: ["heic-convert"],
  /** VPS/Docker (Timeweb и t.п.): см. `Dockerfile`. Для Netlify при сборке задайте `NETLIFY=true` — тогда без `standalone` (вывод плагину). */
  ...(!onNetlify ? { output: "standalone" as const } : {}),
  /**
   * HTML не кэшируем надолго: Safari/iOS держит страницу без CSS после обрыва
   * или после деплоя (старый HTML → новый hash CSS). Статика — immutable.
   */
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/products/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, immutable",
          },
        ],
      },
      {
        source: "/order-form-styles/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, immutable",
          },
        ],
      },
      {
        source:
          "/((?!_next/static|_next/image|favicon.ico|products/|order-form-styles/).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "private, max-age=0, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
