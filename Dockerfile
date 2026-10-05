FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.28.2
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/data/shenlun.db
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY teacher-admin/package.json teacher-admin/package.json
COPY miniprogram/package.json miniprogram/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm --filter backend build
FROM base AS backend
RUN mkdir -p /data/storage && chown -R node:node /data /app/backend/prisma
USER node
EXPOSE 4000
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter backend start"]
FROM base AS teacher
ENV API_PROXY_URL=http://backend:4000
RUN pnpm --filter teacher-admin build && chown -R node:node /app/teacher-admin/.next
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "teacher-admin", "start"]
