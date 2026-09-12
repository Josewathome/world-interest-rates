FROM node:20-alpine

WORKDIR /app

COPY api/package.json api/package-lock.json* ./
RUN npm install --omit=dev

COPY api/src ./src
COPY public ../public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
