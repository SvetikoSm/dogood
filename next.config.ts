import type { NextConfig } from "next";

const onNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  /** VPS/Docker (Timeweb и т.п.): см. `Dockerfile`. Для Netlify при сборке задайте `NETLIFY=true` — тогда без `standalone` (вывод плагину). */
  ...(!onNetlify ? { output: "standalone" as const } : {}),
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
