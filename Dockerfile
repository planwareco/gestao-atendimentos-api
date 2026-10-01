# syntax=docker/dockerfile:1
# Imagem única com dois alvos:
#   docker build --target api    -t gestao-api .
#   docker build --target worker -t gestao-worker .

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall roda `prisma generate`; o CLI do Prisma é dependência de produção (migrate deploy)
RUN npm ci --omit=dev

FROM base AS api
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]

# Worker precisa do Chromium para gerar os PDFs
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
CMD ["node", "src/worker.js"]
