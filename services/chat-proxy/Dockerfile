FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY services/_shared ./services/_shared
COPY services/chat-proxy ./services/chat-proxy

EXPOSE 8789

CMD ["npm", "run", "chat:start"]
