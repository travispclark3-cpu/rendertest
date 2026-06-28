# API server for Render (frontend deploys separately on Vercel)
FROM node:24-slim

RUN corepack enable

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production

WORKDIR /app/artifacts/api-server

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
