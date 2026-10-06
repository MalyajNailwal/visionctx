FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/docker ./docker
COPY --from=builder /app/pricing.yaml ./pricing.yaml
RUN mkdir -p /app/data
CMD ["node", "dist/apps/cli/index.js", "start", "--config", "docker/visionctx.config.yaml"]
