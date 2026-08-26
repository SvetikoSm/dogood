# Сборка: docker build -t dogood-v2 .
# Запуск: docker run --env-file .env.production -p 3000:3000 -v dogood-data:/app/data dogood-v2
FROM node:22-bookworm-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_CACHE_BUST_ID=safari
ENV NEXT_PUBLIC_CACHE_BUST_ID=$NEXT_PUBLIC_CACHE_BUST_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl: Telegram Bot API from this VPS — Node TLS is DPI-blackholed, curl works.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# heic-convert (serverExternalPackages) — явно, если tracer не подтянул зависимость
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/heic-convert ./node_modules/heic-convert
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/heic-decode ./node_modules/heic-decode
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jpeg-js ./node_modules/jpeg-js
# sharp (даунскейл фото перед отправкой в LLM) — нативный, standalone-tracer его не тянет
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

RUN mkdir -p /app/data/order-submissions && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=15s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
