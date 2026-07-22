// @ts-check

import { readFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";

const port = Number(process.env.PORT ?? 3443);
const certificatePath = process.env.TLS_CERT_PATH;
const keyPath = process.env.TLS_KEY_PATH;
const upstream = new URL(process.env.RELEASE_EDGE_UPSTREAM ?? "http://console:3200");

if (!certificatePath || !keyPath) throw new Error("TLS certificate and key paths are required.");

const server = https.createServer({
  cert: readFileSync(certificatePath),
  key: readFileSync(keyPath),
  minVersion: "TLSv1.2"
}, (request, response) => {
  if (request.url === "/edge-healthz") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end('{"status":"ok","tls":true}');
    return;
  }
  const proxy = http.request({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: upstream.host, "x-forwarded-proto": "https" }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, {
      ...upstreamResponse.headers,
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer"
    });
    upstreamResponse.pipe(response);
  });
  proxy.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end('{"error":{"code":"CONSOLE_UNAVAILABLE","message":"Console upstream is unavailable."}}');
  });
  request.pipe(proxy);
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, "0.0.0.0", () => console.log(`Alphonse TLS edge listening on ${port}.`));
