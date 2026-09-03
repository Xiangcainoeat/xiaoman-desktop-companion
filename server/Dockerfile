FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=18080 \
    SOCIAL_DB_PATH=/data/social.sqlite

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 18080

CMD ["node", "src/index.js"]
