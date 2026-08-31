FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 42069
# Shell form so the platform-injected PORT is honored (Railway etc.).
CMD npx ponder start --port ${PORT:-8080} --schema ${DATABASE_SCHEMA:-pop}
