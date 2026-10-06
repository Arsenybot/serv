# Multi-stage Dockerfile for LocalPaaS
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy sources and build frontend bundle
COPY . .
RUN npm run build

# Runner image
FROM node:22-alpine AS runner

WORKDIR /app

# Install Git and utilities for pulling repositories
RUN apk add --no-cache git curl bash

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server sources
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
