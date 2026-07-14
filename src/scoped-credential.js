import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize } from "./canonical-json.js";

export function issueScopedCredential(document, secret) {
  const payload = Buffer.from(canonicalize(document), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `v1.${payload}.${signature}`;
}

export function verifyScopedCredential(token, secret, now = Date.now()) {
  if (typeof token !== "string") return null;
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (version !== "v1" || !payload || !suppliedSignature || extra !== undefined) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex"), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const document = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!document || typeof document !== "object" || now >= Date.parse(document.expires_at)) return null;
    return document;
  } catch {
    return null;
  }
}
