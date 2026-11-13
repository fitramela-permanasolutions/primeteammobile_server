# Multi-stage build for PrimeTeam Mobile Backend API
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled files and docs from builder
COPY --from=builder /app/dist ./dist

# Create upload directory inside container
RUN mkdir -p /var/www/html/files

EXPOSE 5000

CMD ["node", "dist/index.js"]
