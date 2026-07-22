FROM node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS console-build

WORKDIR /console
COPY apps/console/package.json apps/console/package-lock.json ./
RUN npm ci
COPY apps/console ./
RUN npm run build && npm prune --omit=dev

FROM node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS console

WORKDIR /console
COPY --from=console-build --chown=node:node /console /console
ENV NODE_ENV=production
USER node
EXPOSE 3200
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3200"]

FROM node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS kernel

WORKDIR /app
COPY package.json package-lock.json ./
COPY Dockerfile ./Dockerfile
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY diagnostic-migrations ./diagnostic-migrations
COPY schemas ./schemas
COPY packages ./packages
COPY src ./src

RUN mkdir -p /var/lib/alphonse-diagnostics && chown node:node /var/lib/alphonse-diagnostics

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
