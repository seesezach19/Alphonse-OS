import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { buildStageArtifactArchive, verifyStageArtifactArchive } from "../../src/stage-artifact-archive.js";
import { VERIFIER_ARTIFACT_DIGEST, VERIFIER_ARTIFACT_MANIFEST } from "../../verifier/artifact.js";
import { CORRELATION_RULES_DIGEST as INDEPENDENT_RULES_DIGEST } from "../../verifier/correlation.js";
import { CORRELATION_RULES_DIGEST as PRODUCTION_RULES_DIGEST } from "../../src/correlation-projector.js";

test("stage archives preserve every exact activated file and reject byte substitution", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-stage-archive-"));
  context.after(async () => { await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true })); });
  await writeFile(path.join(root, "entry.js"), "export const value = 1;\n");
  const bytes = await readFile(path.join(root, "entry.js"));
  const manifest = { schema_version: "fixture.stage-manifest.v0.1", entrypoints: ["entry.js"],
    module_closure: [{ path: "entry.js", size_bytes: bytes.length,
      digest: `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}` }],
    bound_files: [], runtime: { node_version: process.version, module_format: "node-esm-source" } };
  const archive = buildStageArtifactArchive(manifest, { projectRoot: root });
  assert.equal(archive.stage_artifact_digest, sha256Digest(manifest));
  assert.doesNotThrow(() => verifyStageArtifactArchive(archive));
  const changed = structuredClone(archive);
  changed.files[0].bytes_base64 = Buffer.from("changed").toString("base64");
  assert.throws(() => verifyStageArtifactArchive(changed), /archive file/i);
});

test("offline verifier has a closed local artifact and does not import production business logic", async () => {
  assert.match(VERIFIER_ARTIFACT_DIGEST, /^sha256:[0-9a-f]{64}$/);
  assert.equal(VERIFIER_ARTIFACT_MANIFEST.implementation_boundary,
    "offline-no-production-business-logic-imports");
  assert.equal(INDEPENDENT_RULES_DIGEST, PRODUCTION_RULES_DIGEST);
  for (const entry of VERIFIER_ARTIFACT_MANIFEST.files) {
    const source = await readFile(path.resolve(entry.path), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\.\/src\//);
    assert.doesNotMatch(source, /diagnostic-(correlation|effect-evaluation|evidence-package)-service/);
  }
});
