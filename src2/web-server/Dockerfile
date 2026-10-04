# Multi-stage / lightweight Node.js container for Google Cloud Run
FROM node:20-slim AS runner

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source
COPY . .
RUN chmod -R a+r /app

# Set container defaults for Google Cloud Run
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Run as non-root user
USER node

CMD ["node", "src/server.js"]
