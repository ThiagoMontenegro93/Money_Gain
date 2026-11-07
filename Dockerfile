# LendControl Pro V6.5 — imagem única: API NestJS servindo o app web (mesma origem) em /, API em /api.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @lendcontrol/core build \
 && cd apps/api && npx prisma generate && npx nest build \
 && cd ../app && EXPO_PUBLIC_API_URL=/api npx expo export --platform web
RUN pnpm prune --prod --config.ignore-scripts=true || true

FROM node:22-bookworm-slim
# fontes para o texto da marca d'água (sharp/SVG) e certificados para SMTP/WhatsApp
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/storage WEB_DIST_DIR=/app/apps/app/dist
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core/package.json ./packages/core/package.json
COPY --from=build /repo/packages/core/dist ./packages/core/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/app/dist ./apps/app/dist
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
WORKDIR /app/apps/api
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
