FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends mariadb-client \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . /app/dist
COPY docker-entrypoint.js ./docker-entrypoint.js

EXPOSE 3002

CMD ["node", "docker-entrypoint.js"]
