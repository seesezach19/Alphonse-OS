import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAgencyLabCase } from "../packages/agency-lab/src/case-contract.js";
import { scoreDiagnosisResponse } from "../packages/agency-lab/src/diagnosis-scoring.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function repositoryPath(relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Agency Lab path escaped the repository");
  return resolved;
}

async function readRepositoryJson(relativePath) {
  return JSON.parse(await readFile(repositoryPath(relativePath), "utf8"));
}

async function readInputJson(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : repositoryPath(filePath);
  return JSON.parse(await readFile(resolved, "utf8"));
}

const [caseFile, diagnosisFile, runWorkspace] = process.argv.slice(2);
if (!caseFile || !diagnosisFile || !runWorkspace) {
  throw new Error("Usage: agency-lab-score.js <case-file> <diagnosis-file> <run-workspace>");
}

const definition = validateAgencyLabCase(await readRepositoryJson(caseFile));
const answerKey = await readRepositoryJson(definition.controller.answer_key_file);
const response = await readInputJson(diagnosisFile);
const runRoot = path.resolve(runWorkspace);
const workerRoot = path.join(runRoot, "worker");
const evidenceContext = {
  manifest: await readInputJson(path.join(workerRoot, "manifest.json")),
  evidence: await readInputJson(path.join(workerRoot, "evidence.json")),
  assignment: await readInputJson(path.join(workerRoot, "assignment.json")),
  provenance: await readInputJson(path.join(runRoot, "run-provenance.json"))
};
try {
  const report = scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response,
    evidenceContext
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  if (!String(error?.message).startsWith("Invalid Agency Lab provenance:")) throw error;
  console.log(JSON.stringify({
    schema_version: "0.1.0",
    state: "unscorable",
    issue: { code: "INVALID_PROVENANCE", message: error.message }
  }, null, 2));
  process.exitCode = 1;
}
