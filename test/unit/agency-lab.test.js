import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgencyLabCase } from "../../packages/agency-lab/src/case-contract.js";
import { runAgencyLabCase } from "../../packages/agency-lab/src/controller.js";
import {
  scoreDiagnosisResponse,
  validateDiagnosisResponse
} from "../../packages/agency-lab/src/diagnosis-scoring.js";
import {
  createRunWorkspace,
  resolveContainedPath,
  validateRunId
} from "../../packages/agency-lab/src/run-workspace.js";
import {
  buildRunProvenance,
  buildWorkerAssignment,
  writeImmutableJson
} from "../../packages/agency-lab/src/run-provenance.js";
import { sha256Digest } from "../../src/canonical-json.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

async function caseAndFixture(caseName) {
  const definition = validateAgencyLabCase(await readJson(
    `agency-lab/cases/lead-ingestion/${caseName}/case.json`
  ));
  const fixture = await readJson(definition.scenario.input_fixture);
  return { definition, fixture };
}

function decodePointerToken(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function ensurePointer(document, pointer) {
  const tokens = pointer.slice(1).split("/").map(decodePointerToken);
  let current = document;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const final = index === tokens.length - 1;
    if (Array.isArray(current)) {
      const position = Number(token);
      if (final) current[position] = current[position] ?? "preserved evidence";
      else current[position] ??= /^(0|[1-9][0-9]*)$/.test(tokens[index + 1]) ? [] : {};
      current = current[position];
    } else {
      if (final) current[token] ??= "preserved evidence";
      else current[token] ??= /^(0|[1-9][0-9]*)$/.test(tokens[index + 1]) ? [] : {};
      current = current[token];
    }
  }
}

function bindDiagnosisToEvidence(response, answerKey, caseDefinition) {
  const runId = randomUUID();
  const assignmentId = randomUUID();
  const workerRegistrationId = randomUUID();
  const evidence = { schema_version: "0.1.0", failure_id: response.failure_id };
  for (const reference of response.evidence_references) {
    const [source, pointer] = reference.split("#");
    if (source === "evidence.json" && pointer?.startsWith("/")) ensurePointer(evidence, pointer);
  }
  const evidenceDigest = sha256Digest(evidence);
  const manifest = {
    schema_version: "0.1.0",
    run_id: runId,
    assignment_id: assignmentId,
    worker_registration_id: workerRegistrationId,
    failure_id: response.failure_id,
    case_id: `case-${response.failure_id.toLowerCase()}`,
    evidence_file: "evidence.json",
    answer_key_included: false,
    evidence_artifact_digest: evidenceDigest
  };
  const assignment = buildWorkerAssignment({
    runId,
    assignmentId,
    workerRegistrationId,
    failureId: response.failure_id,
    caseId: manifest.case_id,
    revisionId: "revision-fixture",
    instructionDigest: sha256Digest({ instruction: "fixture diagnosis" }),
    manifestDigest: sha256Digest(manifest),
    evidenceArtifactDigest: evidenceDigest,
    assignedArtifactDigests: [evidenceDigest],
    createdAt: "2026-07-16T16:00:00.000Z",
    expiresAt: "2026-07-16T17:00:00.000Z"
  });
  const provenance = buildRunProvenance({
    assignment,
    assignmentDigest: sha256Digest(assignment),
    caseDefinitionDigest: sha256Digest(caseDefinition),
    fixtureDigest: sha256Digest({ fixture: response.failure_id }),
    answerKeyDigest: sha256Digest(answerKey)
  });
  return {
    response: {
      ...response,
      assignment_id: assignmentId,
      evidence_artifact_digest: evidenceDigest
    },
    evidenceContext: { evidence, manifest, assignment, provenance }
  };
}

test("Agency Lab cases use exact bounded contracts", async () => {
  const { definition } = await caseAndFixture("case-002");
  assert.equal(definition.failure_id, "LEAD-002");
  assert.equal(definition.expected_response_class, "reconcile");
  assert.equal(definition.worker_policy.prohibited_inputs.includes("answer_key"), true);
  assert.throws(() => validateAgencyLabCase({ ...definition, hidden_answer: true }),
    /fields must be exact/);
  assert.throws(() => validateAgencyLabCase({ ...definition, expected_response_class: "guess" }),
    /expected_response_class is unsupported/);
});

test("failure identifiers reject traversal, absolute paths, UNC paths, and separators", async () => {
  const { definition } = await caseAndFixture("case-001");
  for (const failureId of [
    "../ESCAPE", "..\\ESCAPE", "C:\\Users\\Zach", "\\\\server\\share",
    "/absolute", "LEAD/001", "LEAD\\001"
  ]) {
    assert.throws(() => validateAgencyLabCase({ ...definition, failure_id: failureId }),
      /uppercase metadata identifier/);
  }
});

test("run workspaces remain beneath a fixed root and never reuse caller-controlled paths", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "alphonse-run-root-"));
  try {
    const workspace = await createRunWorkspace({ baseDirectory });
    assert.match(workspace.runId, /^[0-9a-f-]{36}$/);
    assert.equal(path.relative(baseDirectory, workspace.workerRoot).startsWith(".."), false);
    assert.throws(() => resolveContainedPath(baseDirectory, "..", "escape"), /escaped its fixed root/);
    for (const runId of ["../escape", "C:\\escape", "\\\\server\\share", "LEAD-001"]) {
      assert.throws(() => validateRunId(runId), /lowercase UUID v4/);
    }
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
});

test("parallel worker assignments receive isolated write-once provenance", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "alphonse-parallel-runs-"));
  try {
    const workspaces = await Promise.all(Array.from({ length: 16 }, () =>
      createRunWorkspace({ baseDirectory })));
    const records = await Promise.all(workspaces.map(async (workspace, index) => {
      const createdAt = new Date(Date.UTC(2026, 6, 16, 16, 0, index)).toISOString();
      const digest = sha256Digest({ index });
      const assignment = buildWorkerAssignment({
        runId: workspace.runId,
        assignmentId: randomUUID(),
        workerRegistrationId: randomUUID(),
        failureId: "LEAD-001",
        caseId: `case-${index}`,
        revisionId: `revision-${index}`,
        instructionDigest: digest,
        manifestDigest: digest,
        evidenceArtifactDigest: digest,
        assignedArtifactDigests: [digest],
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 60 * 60 * 1000).toISOString()
      });
      const assignmentRecord = await writeImmutableJson(
        workspace.workerRoot,
        "assignment.json",
        assignment
      );
      const provenance = buildRunProvenance({
        assignment,
        assignmentDigest: assignmentRecord.digest,
        caseDefinitionDigest: digest,
        fixtureDigest: digest,
        answerKeyDigest: digest
      });
      await writeImmutableJson(workspace.runRoot, "run-provenance.json", provenance);
      return { workspace, assignment, provenance };
    }));

    assert.equal(new Set(records.map(({ workspace }) => workspace.runRoot)).size, records.length);
    assert.equal(new Set(records.map(({ assignment }) => assignment.assignment_id)).size, records.length);
    for (const [index, record] of records.entries()) {
      assert.equal(record.provenance.run_id, record.workspace.runId);
      assert.equal(record.provenance.case_id, `case-${index}`);
      assert.equal(record.provenance.worker_assignment_digest, sha256Digest(record.assignment));
    }
    await assert.rejects(() => writeImmutableJson(
      records[0].workspace.runRoot,
      "run-provenance.json",
      records[0].provenance
    ), (error) => error?.code === "EEXIST");
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
});

test("one invariant engine demonstrates and repairs all lead cases", async () => {
  for (const caseName of ["case-001", "case-002", "case-003", "case-004"]) {
    const { definition, fixture } = await caseAndFixture(caseName);
    const result = runAgencyLabCase(definition, fixture);
    assert.equal(result.failure_demonstrated, true);
    assert.equal(result.invariants.baseline.passed, false);
    assert.equal(result.repaired_passed, true);
    assert.equal(result.invariants.repaired.passed, true);
  }
});

test("structured blind diagnoses receive deterministic case-owned scores", async () => {
  for (const [caseName, expectedScore] of [
    ["case-001", 15], ["case-002", 13], ["case-003", 15], ["case-004", 15]
  ]) {
    const { definition } = await caseAndFixture(caseName);
    const answerKey = await readJson(definition.controller.answer_key_file);
    const rawResponse = await readJson(
      `agency-lab/cases/lead-ingestion/${caseName}/worker-runs/openclaw-001.json`
    );
    const { response, evidenceContext } = bindDiagnosisToEvidence(rawResponse, answerKey, definition);
    const score = scoreDiagnosisResponse({
      caseDefinition: definition,
      answerKey,
      response,
      evidenceContext
    });
    assert.equal(score.passed, true);
    assert.equal(score.score, expectedScore);
    assert.equal(score.maximum_score, 15);
    assert.equal(score.assurance.worker_compliance, "self_reported");
    assert.equal(score.assurance.semantic_support, "not_independently_evaluated");
  }
});

test("diagnosis scoring fails closed on unstructured or cross-case output", async () => {
  const { definition } = await caseAndFixture("case-002");
  const answerKey = await readJson(definition.controller.answer_key_file);
  const rawResponse = await readJson(
    "agency-lab/cases/lead-ingestion/case-002/worker-runs/openclaw-001.json"
  );
  const { response, evidenceContext } = bindDiagnosisToEvidence(rawResponse, answerKey, definition);
  assert.throws(() => validateDiagnosisResponse({ ...response, extra: true }), /fields must be exact/);
  assert.throws(() => scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response: { ...response, failure_id: "LEAD-999" },
    evidenceContext
  }), /failure_id does not match/);
});

test("citation validity gives nonexistent pointers zero credit", async () => {
  const { definition } = await caseAndFixture("case-004");
  const answerKey = await readJson(definition.controller.answer_key_file);
  const rawResponse = await readJson(
    "agency-lab/cases/lead-ingestion/case-004/worker-runs/openclaw-001.json"
  );
  const { response, evidenceContext } = bindDiagnosisToEvidence(rawResponse, answerKey, definition);
  const score = scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response: {
      ...response,
      evidence_references: [
        "evidence.json#/invented/0",
        "evidence.json#/invented/1",
        "evidence.json#/invented/2",
        "evidence.json#/invented/3"
      ]
    },
    evidenceContext
  });
  const citation = score.criteria.find((criterion) => criterion.criterion_id === "citation-validity");
  assert.equal(citation.passed, false);
  assert.equal(citation.score, 0);
  assert.match(citation.detail, /^0\/4 references resolve/);
});

test("diagnosis scoring rejects evidence changed after its manifest digest", async () => {
  const { definition } = await caseAndFixture("case-004");
  const answerKey = await readJson(definition.controller.answer_key_file);
  const rawResponse = await readJson(
    "agency-lab/cases/lead-ingestion/case-004/worker-runs/openclaw-001.json"
  );
  const { response, evidenceContext } = bindDiagnosisToEvidence(rawResponse, answerKey, definition);
  evidenceContext.evidence.tampered = true;
  assert.throws(() => scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response,
    evidenceContext
  }), /do not match the manifest artifact digest/);
});

test("diagnosis scoring rejects mismatched assignment and evidence identities as unscorable", async () => {
  const { definition } = await caseAndFixture("case-004");
  const answerKey = await readJson(definition.controller.answer_key_file);
  const rawResponse = await readJson(
    "agency-lab/cases/lead-ingestion/case-004/worker-runs/openclaw-001.json"
  );
  const { response, evidenceContext } = bindDiagnosisToEvidence(rawResponse, answerKey, definition);
  assert.throws(() => scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response: { ...response, assignment_id: randomUUID() },
    evidenceContext
  }), /diagnosis assignment_id does not match/);
  assert.throws(() => scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response: { ...response, evidence_artifact_digest: `sha256:${"0".repeat(64)}` },
    evidenceContext
  }), /diagnosis evidence digest does not match/);
});
