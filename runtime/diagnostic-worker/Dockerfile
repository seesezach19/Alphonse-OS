FROM node@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /worker
COPY runtime/diagnostic-worker/worker.js ./worker.js

USER 10001:10001
CMD ["node", "worker.js"]
