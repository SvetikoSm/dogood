import type { NextConfig } from "next";

const onNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  /** VPS/Docker: см. `Dockerfile`. На Netlify оставляем вывод плагину (`NETLIFY=true` при сборке). */
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
