FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./

RUN if [ -f package-lock.json ]; then \
      npm ci --include=optional --omit=dev --no-audit --no-fund || npm install --include=optional --omit=dev --no-audit --no-fund; \
    else \
      npm install --include=optional --omit=dev --no-audit --no-fund; \
    fi

COPY backend/ ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
