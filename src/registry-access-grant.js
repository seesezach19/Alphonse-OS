import { createHmac, timingSafeEqual } from "node:crypto";

export class RegistryAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RegistryAccessError";
    this.status = status;
    this.code = code;
  }
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signRegistryAccessGrant(document, secret) {
  const payload = Buffer.from(JSON.stringify(document)).toString("base64url");
  return `registry-grant-v0.${payload}.${signature(payload, secret)}`;
}

function packageAllowed(packageId, scopes) {
  return scopes.some((scope) => scope === "*" || scope === packageId
    || (scope.endsWith(".*") && (packageId === scope.slice(0, -2)
      || packageId.startsWith(`${scope.slice(0, -2)}.`))));
}

export function verifyRegistryAccessGrant(token, secret, { registryId, action, packageId,
  now = new Date().toISOString() }) {
  const [prefix, payload, suppliedSignature, extra] = String(token ?? "").split(".");
  if (prefix !== "registry-grant-v0" || !payload || !suppliedSignature || extra) {
    throw new RegistryAccessError(401, "REGISTRY_AUTHENTICATION_REQUIRED", "Scoped Registry access grant is required.");
  }
  const expectedSignature = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new RegistryAccessError(403, "REGISTRY_GRANT_SIGNATURE_INVALID", "Registry access grant signature is invalid.");
  }
  let document;
  try {
    document = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new RegistryAccessError(403, "REGISTRY_GRANT_INVALID", "Registry access grant is invalid.");
  }
  const at = Date.parse(now);
  const issuedAt = Date.parse(document.issued_at);
  const expiresAt = Date.parse(document.expires_at);
  if (document.schema_version !== "alphonse.registry_access_grant.v0.1"
      || document.registry_id !== registryId || !Array.isArray(document.actions)
      || !Array.isArray(document.package_scopes) || !document.actions.includes(action)
      || !Number.isFinite(at) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || issuedAt >= expiresAt || at < issuedAt || at >= expiresAt
      || !packageAllowed(packageId, document.package_scopes)) {
    throw new RegistryAccessError(403, "REGISTRY_GRANT_SCOPE_DENIED", "Registry access grant does not admit this request.");
  }
  return document;
}
