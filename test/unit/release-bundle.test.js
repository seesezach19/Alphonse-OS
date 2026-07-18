import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildRelease, collectReleaseEntries, validateReleaseEntries } from "../../scripts/release-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("V0.1 release archive is byte-reproducible and content-addressed", async () => {
  const first = await buildRelease(root);
  const second = await buildRelease(root);
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.archiveDigest, second.archiveDigest);
  assert.match(first.archiveName, /^alphonse-kernel-v0\.1\.0-[0-9a-f]{16}\.tar$/);
  assert.equal(first.manifest.archive.normalized_mtime, 0);
  assert.equal(first.policy.valid, true);
});

test("release pins every component, migration, dependency, and base image", async () => {
  const release = await buildRelease(root);
  const components = release.manifest.components;
  assert.deepEqual(Object.keys(components).sort(),
    ["butler", "coordinator", "data_plane", "kernel", "reference_package", "registry", "substrate"]);
  for (const component of Object.values(components).filter((item) => item.entrypoint)) {
    assert.match(component.source_digest, /^sha256:[0-9a-f]{64}$/);
  }
  assert.match(release.manifest.base_images.node, /@sha256:[0-9a-f]{64}$/);
  assert.match(release.manifest.base_images.postgres, /@sha256:[0-9a-f]{64}$/);
  const migrations = release.manifest.payload_files.filter((item) => item.path.startsWith("migrations/"));
  assert.equal(migrations.length, 23);
  assert.ok(migrations.every((item) => /^sha256:[0-9a-f]{64}$/.test(item.digest)));
});

test("release excludes scaffolds, credentials, provider memory, and database host authority", async () => {
  const entries = await collectReleaseEntries(root);
  const paths = entries.map((entry) => entry.path);
  assert.equal(paths.some((entry) => /\.scratch|CONTEXT\.md|^test\/|^proof\//.test(entry)), false);
  assert.equal(validateReleaseEntries(entries).valid, true);

  const secret = [...entries, { path: "leaked.env", mode: 0o644,
    bytes: Buffer.from("KEY=ed25519-pkcs8:MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAA") }];
  assert.ok(validateReleaseEntries(secret).issues.some((issue) => issue.code === "SECRET_MATERIAL_INCLUDED"));

  const exposed = entries.map((entry) => entry.path === "compose.yaml" ? { ...entry,
    bytes: Buffer.from(entry.bytes.toString("utf8").replace("    environment:\n      POSTGRES_DB",
      "    ports:\n      - \"5432:5432\"\n    environment:\n      POSTGRES_DB")) } : entry);
  assert.ok(validateReleaseEntries(exposed).issues.some((issue) => issue.code === "DIRECT_DATABASE_HOST_PORT"));
});

test("USTAR headers normalize modification time to zero", async () => {
  const release = await buildRelease(root);
  const firstHeader = release.archive.subarray(0, 512);
  const mtime = firstHeader.subarray(136, 148).toString("ascii").replace(/\0.*$/, "");
  assert.equal(Number.parseInt(mtime, 8), 0);
});
