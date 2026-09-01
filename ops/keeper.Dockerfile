# Keeper worker for Railway. Point the service at this file with
# RAILWAY_DOCKERFILE_PATH=ops/keeper.Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY ops/package.json ./
RUN npm install --omit=dev
COPY ops/keeper.mjs ./
CMD ["node", "keeper.mjs"]
