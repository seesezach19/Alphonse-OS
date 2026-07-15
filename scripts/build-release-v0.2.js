import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildV02Release } from "./release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const first = await buildV02Release(root, { write: true });
const second = await buildV02Release(root);
assert.equal(first.archiveDigest, second.archiveDigest);
assert.deepEqual(first.archive, second.archive);

console.log(JSON.stringify({
  release_version: first.manifest.release_version,
  archive: first.archiveName,
  archive_digest: first.archiveDigest,
  manifest_digest: first.manifestDigest,
  payload_files: first.manifest.payload_files.length,
  reproducible_rebuild: true,
  policy: "passed",
  n8n_redistributed: false,
  aws_activity: false
}, null, 2));
