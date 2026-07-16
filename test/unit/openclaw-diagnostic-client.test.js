import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDiagnosis,
  loadConnectionEnvironment,
  stableCommandId
} from "../../packages/openclaw-diagnostic-workspace/skill/scripts/alphonse-diagnostic.mjs";

const workspace = {
  diagnosis_request: {
    instruction_digest: `sha256:${"a".repeat(64)}`,
    input_artifact_digests: [`sha256:${"b".repeat(64)}`]
  }
};
const analysis = {
  facts: [{ statement: "Observed fact.", artifact_references: [`sha256:${"b".repeat(64)}`] }],
  inferences: [],
  hypotheses: [{
    statement: "Possible cause.", confidence: "medium",
    supporting_artifact_references: [`sha256:${"b".repeat(64)}`],
    contradicting_artifact_references: []
  }],
  uncertainties: ["Scope remains bounded."],
  recommended_investigation: [],
  artifact_references: [`sha256:${"b".repeat(64)}`]
};

test("buildDiagnosis binds exact workspace provenance without receiving provider credentials", () => {
  const diagnosis = buildDiagnosis(workspace, analysis, {
    ALPHONSE_MODEL_PROVIDER: "customer-provider",
    ALPHONSE_MODEL_ID: "customer-model",
    ALPHONSE_MODEL_VERSION: "snapshot-1",
    OPENCLAW_VERSION: "test-version"
  });
  assert.equal(diagnosis.provenance.instruction_digest, workspace.diagnosis_request.instruction_digest);
  assert.deepEqual(diagnosis.provenance.input_artifact_digests,
    workspace.diagnosis_request.input_artifact_digests);
  assert.equal(diagnosis.provenance.runtime.name, "openclaw");
  assert.equal("token" in diagnosis.provenance, false);
});

test("stableCommandId is deterministic and changes with proposal material", () => {
  assert.equal(stableCommandId("diagnosis", analysis), stableCommandId("diagnosis", structuredClone(analysis)));
  assert.notEqual(stableCommandId("diagnosis", analysis),
    stableCommandId("diagnosis", { ...analysis, uncertainties: ["Changed."] }));
});

test("buildDiagnosis rejects credential-shaped output before network submission", () => {
  assert.throws(() => buildDiagnosis(workspace, {
    ...analysis,
    facts: [{ ...analysis.facts[0], provider_token: "must-not-leave-worker" }]
  }), /credential-like material/);
});

test("connection file supplies the exact assignment without runtime environment injection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alphonse-connection-"));
  const connectionFile = path.join(directory, "diagnostic.env");
  try {
    await writeFile(connectionFile, [
      "ALPHONSE_URL=http://127.0.0.1:43240",
      `ALPHONSE_AGENT_TOKEN=${"t".repeat(64)}`,
      "ALPHONSE_DIAGNOSIS_REQUEST_ID=00000000-0000-4000-8000-000000000901",
      "OPENCLAW_VERSION=test",
      ""
    ].join("\n"));
    const loaded = await loadConnectionEnvironment({ ALPHONSE_CONNECTION_FILE: connectionFile });
    assert.equal(loaded.ALPHONSE_URL, "http://127.0.0.1:43240");
    assert.equal(loaded.ALPHONSE_AGENT_TOKEN, "t".repeat(64));
    assert.equal(loaded.ALPHONSE_DIAGNOSIS_REQUEST_ID, "00000000-0000-4000-8000-000000000901");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing assignment fails closed instead of falling back to Owner authority", async () => {
  await assert.rejects(loadConnectionEnvironment({
    ALPHONSE_CONNECTION_FILE: path.join(os.tmpdir(), "alphonse-connection-does-not-exist")
  }), /Do not use Owner or bootstrap credentials as a fallback/);
});
