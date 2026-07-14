import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Digest } from "../../src/canonical-json.js";

test("canonical JSON ignores object key order", () => {
  assert.equal(canonicalize({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(sha256Digest({ b: 2, a: 1 }), sha256Digest({ a: 1, b: 2 }));
});

test("canonical JSON preserves array order", () => {
  assert.notEqual(sha256Digest([1, 2]), sha256Digest([2, 1]));
});
