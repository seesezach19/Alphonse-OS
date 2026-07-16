import { writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256Digest } from "../../../src/canonical-json.js";
import { resolveContainedPath, validateRunId } from "./run-workspace.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FAILURE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error(`Agency Lab ${field} must be bounded text`);
  }
  return value;
}

function requireDigest(value, field) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`Agency Lab ${field} must be a SHA-256 digest`);
  }
  return value;
}

function requireTimestamp(value) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new Error("Agency Lab created_at must be an ISO timestamp");
  }
  return value;
}

export function buildWorkerAssignment({
  runId,
  assignmentId,
  failureId,
  caseId,
  revisionId,
  manifestDigest,
  evidenceArtifactDigest,
  createdAt
}) {
  if (!FAILURE_ID.test(failureId)) throw new Error("Agency Lab failure_id is invalid");
  return {
    schema_version: "0.1.0",
    record_type: "agency_lab_worker_assignment",
    run_id: validateRunId(runId),
    assignment_id: validateRunId(assignmentId),
    failure_id: failureId,
    case_id: requireText(caseId, "case_id"),
    revision_id: requireText(revisionId, "revision_id"),
    manifest_digest: requireDigest(manifestDigest, "manifest_digest"),
    evidence_artifact_digest: requireDigest(evidenceArtifactDigest, "evidence_artifact_digest"),
    created_at: requireTimestamp(createdAt),
    authority: {
      evidence_read: "granted",
      external_effects: "not_granted",
      repair: "not_granted",
      promotion: "not_granted"
    }
  };
}

export function buildRunProvenance({
  assignment,
  assignmentDigest,
  caseDefinitionDigest,
  fixtureDigest,
  answerKeyDigest
}) {
  return {
    schema_version: "0.1.0",
    record_type: "agency_lab_assignment_packaged",
    run_id: assignment.run_id,
    assignment_id: assignment.assignment_id,
    failure_id: assignment.failure_id,
    case_id: assignment.case_id,
    created_at: assignment.created_at,
    state: "packaged",
    worker_workspace: "worker",
    controller_workspace: "controller",
    worker_assignment_digest: requireDigest(assignmentDigest, "worker_assignment_digest"),
    case_definition_digest: requireDigest(caseDefinitionDigest, "case_definition_digest"),
    fixture_digest: requireDigest(fixtureDigest, "fixture_digest"),
    manifest_digest: assignment.manifest_digest,
    evidence_artifact_digest: assignment.evidence_artifact_digest,
    answer_key_digest: requireDigest(answerKeyDigest, "answer_key_digest")
  };
}

export async function writeImmutableJson(directory, fileName, document) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(fileName)) {
    throw new Error("Agency Lab immutable record filename is invalid");
  }
  const filePath = resolveContainedPath(directory, fileName);
  const content = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return { file_path: filePath, digest: sha256Digest(document) };
}
