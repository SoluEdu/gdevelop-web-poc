# ==============================================
# Stage 1: Build
# ==============================================
FROM node:22-alpine AS build

WORKDIR /app

# Copy dulu package files supaya cache layer npm ci lebih optimal
COPY package*.json ./
RUN npm ci

COPY . .

ARG BUILD_DATE
ARG GIT_COMMIT
ENV VITE_BUILD_DATE=${BUILD_DATE} \
    VITE_GIT_COMMIT=${GIT_COMMIT}

RUN npm run build

# ==============================================
# Stage 2: Serve dengan Nginx
# ==============================================
FROM nginx:1.27-alpine

# Hapus konfigurasi default Nginx
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy konfigurasi custom (termasuk endpoint /health)
COPY ./nginx.conf /etc/nginx/conf.d/default.conf

# Copy hasil build Vue (folder dist) ke direktori yang di-serve Nginx
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
