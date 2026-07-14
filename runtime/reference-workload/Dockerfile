FROM node:22-alpine

WORKDIR /workload
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY runtime/reference-workload/workload.js ./workload.js
USER 1000:1000

CMD ["node", "workload.js"]
