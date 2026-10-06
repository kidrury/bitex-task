FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app


FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile


FROM dependencies AS build

COPY . .

RUN pnpm build


FROM base AS production

ENV NODE_ENV=production
ENV NODE_PATH=/app/dist

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

COPY drizzle.config.ts ./
COPY drizzle ./drizzle

EXPOSE 3000

CMD ["node", "dist/src/main.js"]