# ==============================================
# Stage 1: Build (Vue + Vite)
# ==============================================
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG BUILD_DATE
ARG GIT_COMMIT
ENV VITE_BUILD_DATE=${BUILD_DATE} \
    VITE_GIT_COMMIT=${GIT_COMMIT}

RUN npm run build

# ==============================================
# Stage 2: Serve dengan Node (handler GitHub download)
# Node sebagai handler untuk mendownload import dari GitHub,
# lalu tetap simpan di OPFS (OPFS tetap di browser).
# ==============================================
FROM node:22-alpine

WORKDIR /app

# No GitHub credentials in image — token transit only
COPY --from=build /app/dist ./dist
COPY server.mjs ./

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O- http://127.0.0.1:80/health || exit 1

CMD ["node", "server.mjs"]
