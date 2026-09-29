FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV APP_VERSION=1.0.0

EXPOSE 8080

CMD ["node", "server.js"]
