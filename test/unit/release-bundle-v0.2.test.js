import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildV02Release,
  collectV02ReleaseEntries,
  validateV02ReleaseEntries
} from "../../scripts/release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("V0.2 release is byte-reproducible and content-addressed", async () => {
  const first = await buildV02Release(root);
  const second = await buildV02Release(root);
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.archiveDigest, second.archiveDigest);
  assert.match(first.archiveName, /^alphonse-v0\.2\.0-[0-9a-f]{16}\.tar$/);
  assert.equal(first.manifest.archive.normalized_mtime, 0);
  assert.equal(first.policy.valid, true);
});

test("V0.2 manifest pins the complete headless Debug Loop", async () => {
  const release = await buildV02Release(root);
  assert.deepEqual(Object.keys(release.manifest.components).sort(), [
    "diagnostic_cli", "diagnostic_plane", "event_reporter", "kernel",
    "n8n_operational_package", "n8n_repair_delivery_adapter", "n8n_runtime_adapter",
    "reference_workflow", "verification_runner"
  ]);
  assert.ok(Object.values(release.manifest.components)
    .every((component) => /^sha256:[0-9a-f]{64}$/.test(component.source_digest)));
  assert.ok(Object.values(release.manifest.base_images)
    .every((image) => /@sha256:[0-9a-f]{64}$/.test(image)));
  assert.equal(release.manifest.compatible_n8n.redistributed, false);
  assert.equal(release.manifest.compatible_n8n.customer_owned, true);
  assert.equal(release.manifest.payload_files.filter((item) => item.path.startsWith("migrations/")).length, 22);
  assert.equal(release.manifest.payload_files
    .filter((item) => item.path.startsWith("diagnostic-migrations/")).length, 16);
});

test("V0.2 release excludes credentials, development state, test authority, and n8n binaries", async () => {
  const entries = await collectV02ReleaseEntries(root);
  const paths = entries.map((entry) => entry.path);
  assert.equal(paths.some((entry) => /\.scratch|CONTEXT\.md|^test\/|^proof\//.test(entry)), false);
  assert.equal(paths.includes("packages/n8n-operational-package/compose.customer.yaml"), false);
  assert.equal(validateV02ReleaseEntries(entries).valid, true);

  const secret = [...entries, { path: "leaked.env", mode: 0o644,
    bytes: Buffer.from("KEY=ed25519-pkcs8:MC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAA") }];
  assert.ok(validateV02ReleaseEntries(secret).issues.some((issue) => issue.code === "SECRET_MATERIAL_INCLUDED"));

  const unsafe = entries.map((entry) => entry.path === "compose.yaml" ? { ...entry,
    bytes: Buffer.from(entry.bytes.toString("utf8")
      .replace('"127.0.0.1:${KERNEL_PORT:-3000}:3000"', '"0.0.0.0:${KERNEL_PORT:-3000}:3000"')) } : entry);
  assert.ok(validateV02ReleaseEntries(unsafe).issues.some((issue) => issue.code === "NON_LOOPBACK_PORT"));

  const testAuthority = entries.map((entry) => entry.path === "compose.yaml" ? { ...entry,
    bytes: Buffer.from(`${entry.bytes.toString("utf8")}\nN8N_ADAPTER_TEST_CONTROLS_ENABLED: "true"\n`) } : entry);
  assert.ok(validateV02ReleaseEntries(testAuthority).issues.some((issue) => issue.code === "TEST_AUTHORITY_ENABLED"));
});

test("V0.2 operator guide states custody, protocol meaning, recovery, and limitations", async () => {
  const entries = await collectV02ReleaseEntries(root);
  const guide = entries.find((entry) => entry.path === "OPERATOR.md").bytes.toString("utf8");
  const normalizedGuide = guide.replace(/\s+/g, " ");
  for (const required of [
    "n8n remains a separately operated customer service",
    "External Activity is an authenticated observation",
    "broad certification of an agent or workflow",
    "digest tombstone",
    "uncertain promotion must be reconciled read-only",
    "fault-injection controls are disabled",
    "127.0.0.1"
  ]) assert.match(normalizedGuide, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});
