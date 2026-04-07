FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY services/delphi-proxy ./services/delphi-proxy

EXPOSE 8787

CMD ["node", "services/delphi-proxy/server.mjs"]
