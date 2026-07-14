import assert from "node:assert/strict";
import test from "node:test";

import { issueScopedCredential, verifyScopedCredential } from "../../src/scoped-credential.js";

test("scoped credential binds exact document and signature", () => {
  const document = { permit_id: "00000000-0000-4000-8000-000000000001",
    scopes: ["storefront.inventory.write"], target: { resource: "storefront.inventory", subject: "SKU-100" },
    expires_at: "2030-01-01T00:00:00.000Z" };
  const token = issueScopedCredential(document, "issuer-secret");
  assert.deepEqual(verifyScopedCredential(token, "issuer-secret", Date.parse("2029-12-31T23:59:59Z")), document);
  assert.equal(verifyScopedCredential(`${token}tampered`, "issuer-secret", Date.parse("2029-12-31T23:59:59Z")), null);
  assert.equal(verifyScopedCredential(token, "issuer-secret", Date.parse(document.expires_at)), null);
});
