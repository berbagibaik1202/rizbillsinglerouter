FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . /app/dist
COPY docker-entrypoint.js ./docker-entrypoint.js

EXPOSE 3002

CMD ["node", "docker-entrypoint.js"]
