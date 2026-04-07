FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY services/admin-proxy ./services/admin-proxy

EXPOSE 8788

CMD ["node", "services/admin-proxy/server.mjs"]
