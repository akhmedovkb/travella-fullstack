FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package*.json ./backend/
RUN npm ci --prefix backend

COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend

COPY backend ./backend
COPY frontend ./frontend

RUN npm run build --prefix frontend


FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/backend ./backend
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/frontend/dist ./backend/public

EXPOSE 8080
CMD ["npm", "start", "--prefix", "backend"]
