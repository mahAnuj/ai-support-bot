# Reference connector server: Node 20, TypeScript compiled at build time.
# Build:  docker build -t ai-support-bot-connector .
# Skip the model download at build time with --build-arg WARM_MODEL=0
# (the first upload or search then downloads it into /app/.cache).

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ARG WARM_MODEL=1
ENV NODE_ENV=production \
    TRANSFORMERS_CACHE_DIR=/app/.cache
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/src ./dist/src
COPY sql ./sql
RUN mkdir -p /app/.cache && chown node:node /app/.cache
USER node
RUN if [ "$WARM_MODEL" = "1" ]; then node dist/src/warm-model.js; fi
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
