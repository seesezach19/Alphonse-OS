import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pilotDigest, validatePilotEvidence, validatePilotPlan } from "../pilot/v0.2.0/pilot-contract.js";

export function qualifyDesignPartnerPilot(plan, evidence) {
  const planResult = validatePilotPlan(plan);
  if (evidence === undefined) {
    return {
      schema_version: "alphonse.design_partner_pilot_qualification.v0.2",
      packet_prepared: planResult.valid,
      technical_qualified: false,
      commercial_qualified: false,
      qualified: false,
      plan_digest: pilotDigest(plan),
      plan_status: plan?.status ?? null,
      pricing_status: plan?.commercial?.pricing_status ?? null,
      external_gate: Array.isArray(plan?.external_gate) ? plan.external_gate : [],
      issues: planResult.issues
    };
  }
  const evidenceResult = validatePilotEvidence(plan, evidence);
  return {
    schema_version: "alphonse.design_partner_pilot_qualification.v0.2",
    packet_prepared: planResult.valid,
    technical_qualified: evidenceResult.technical_qualified,
    commercial_qualified: evidenceResult.commercial_qualified,
    qualified: evidenceResult.valid,
    plan_digest: pilotDigest(plan),
    plan_status: plan?.status ?? null,
    pricing_status: plan?.commercial?.pricing_status ?? null,
    pilot_id: evidence?.pilot_id ?? null,
    external_gate: Array.isArray(plan?.external_gate) ? plan.external_gate : [],
    issues: evidenceResult.issues
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const [planPath, evidencePath] = process.argv.slice(2);
  if (!planPath) {
    console.error("Usage: node scripts/qualify-design-partner-pilot.js <pilot-plan.json> [pilot-evidence.json]");
    process.exit(2);
  }
  try {
    const plan = await readJson(planPath);
    const evidence = evidencePath ? await readJson(evidencePath) : undefined;
    const result = qualifyDesignPartnerPilot(plan, evidence);
    console.log(JSON.stringify(result, null, 2));
    if (evidencePath && !result.qualified) process.exitCode = 1;
    if (!evidencePath && !result.packet_prepared) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({
      schema_version: "alphonse.design_partner_pilot_qualification.v0.2",
      packet_prepared: false,
      technical_qualified: false,
      commercial_qualified: false,
      qualified: false,
      issues: [{ code: "PILOT_INPUT_UNREADABLE", path: "input", message: error.message }]
    }, null, 2));
    process.exitCode = 1;
  }
}
