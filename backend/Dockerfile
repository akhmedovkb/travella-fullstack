# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./

# package-lock.json может отсутствовать -> используем npm install
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
