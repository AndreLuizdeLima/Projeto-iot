FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY simulator/package.json simulator/package.json
RUN npm ci
COPY shared shared
COPY frontend frontend
RUN npm run build -w @iot/contracts && npm run build -w frontend

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/dist ./public
COPY --chown=node:node frontend/server.mjs ./server.mjs
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
