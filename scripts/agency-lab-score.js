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

const [caseFile, diagnosisFile] = process.argv.slice(2);
if (!caseFile || !diagnosisFile) {
  throw new Error("Usage: agency-lab-score.js <case-file> <diagnosis-file>");
}

const definition = validateAgencyLabCase(await readRepositoryJson(caseFile));
const answerKey = await readRepositoryJson(definition.controller.answer_key_file);
const response = await readInputJson(diagnosisFile);
const report = scoreDiagnosisResponse({ caseDefinition: definition, answerKey, response });
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
