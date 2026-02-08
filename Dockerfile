FROM node:20-alpine

WORKDIR /app

# Kopier package.json og installer kun produktion-dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Kopier resten af projektet
COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server

EXPOSE 8080

CMD ["node", "server.js"]
