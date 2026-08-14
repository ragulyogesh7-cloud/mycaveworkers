FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/server.js"]
