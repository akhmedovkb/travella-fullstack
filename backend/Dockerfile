# backend/Dockerfile
# Railway root_dir=backend -> this Dockerfile WILL be picked up.
# No secrets in ARG/ENV. Secrets must be set in Railway Variables.

FROM node:20-alpine AS build
WORKDIR /app

# --- backend deps
COPY package*.json ./
RUN npm ci

# --- backend source
COPY . .

# --- build frontend (located one level up: ../frontend)
# We copy only what's needed to build it.
WORKDIR /repo
COPY ../frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY ../frontend ./frontend
RUN npm run build --prefix frontend

# Put frontend build into backend/public (backend should serve it)
RUN rm -rf /app/public && mkdir -p /app/public
RUN cp -r /repo/frontend/dist/* /app/public/


FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 8080
CMD ["npm", "start"]
