/**
 * PM2 на VPS без Docker (пример).
 * На сервере: npm ci && npm run build && pm2 start ecosystem.config.cjs
 * Правьте cwd под каталог с репозиторием.
 */
module.exports = {
  apps: [
    {
      name: "dogood-v2",
      cwd: "/var/www/dogood-v2",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production", PORT: "3000" },
    },
  ],
};
