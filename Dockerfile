FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data
ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_PATH=/data/tokens.db
EXPOSE 8080
CMD ["node", "dist/main.js"]
