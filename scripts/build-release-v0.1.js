import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRelease } from "./release-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const first = await buildRelease(root, { write: true });
const second = await buildRelease(root);
assert.equal(first.archiveDigest, second.archiveDigest, "Repeated release builds must produce identical archives.");
assert.deepEqual(first.archive, second.archive, "Repeated release archive bytes must match.");

console.log(JSON.stringify({ release_version: first.manifest.release_version,
  archive: first.archiveName, archive_digest: first.archiveDigest,
  manifest_digest: first.manifestDigest, payload_files: first.manifest.payload_files.length,
  reproducible_rebuild: true, policy: "passed" }, null, 2));
