FROM node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app

COPY package.json package-lock.json ./
COPY Dockerfile ./Dockerfile
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY diagnostic-migrations ./diagnostic-migrations
COPY ingress-migrations ./ingress-migrations
COPY crm-migrations ./crm-migrations
COPY schemas ./schemas
COPY packages ./packages
COPY src ./src

RUN mkdir -p /var/lib/alphonse-diagnostics && chown node:node /var/lib/alphonse-diagnostics

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "src/server.js"]
