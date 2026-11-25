FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --include=optional --no-audit --no-fund || npm install --include=optional --no-audit --no-fund; \
    else \
      npm install --include=optional --no-audit --no-fund; \
    fi
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
