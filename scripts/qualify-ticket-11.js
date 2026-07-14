import fs from "node:fs";

import { validateQualificationPacket, verifyQualificationAgainstPublicState } from "../src/proof-qualification.js";

const packetPath = process.argv[2];
if (!packetPath) {
  console.error("Usage: npm run qualify -- <proof-packet.json>");
  process.exit(2);
}

const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
const structural = validateQualificationPacket(packet);
let result = structural;

if (structural.valid) {
  const operatorToken = process.env.KERNEL_OPERATOR_TOKEN;
  if (!operatorToken) {
    result = { valid: false, issues: [{ code: "OPERATOR_TOKEN_REQUIRED", path: "environment.KERNEL_OPERATOR_TOKEN",
      message: "A runtime operator credential is required to verify public Kernel and Butler state." }] };
  } else {
    try {
      result = await verifyQualificationAgainstPublicState(packet, {
        kernelUrl: (process.env.KERNEL_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""), operatorToken
      });
    } catch (error) {
      result = { valid: false, issues: [{ code: "PUBLIC_STATE_UNAVAILABLE", path: "public",
        message: error.message }] };
    }
  }
}

const report = {
  schema_version: "alphonse.unfamiliar_builder_qualification.v0.1",
  qualified: result.valid,
  proof_session_id: packet.proof_session_id ?? null,
  checked_at: new Date().toISOString(),
  review_summary: Array.isArray(packet.builder_reviews) ? {
    reviews: packet.builder_reviews.length,
    supplied_workflow_interest: packet.builder_reviews.filter((item) => item.supplied_workflow_interest === true).length,
    paid_workflow_interest: packet.builder_reviews.filter((item) => item.paid_workflow_interest === true).length
  } : { reviews: 0, supplied_workflow_interest: 0, paid_workflow_interest: 0 },
  issues: result.issues
};

console.log(JSON.stringify(report, null, 2));
if (!report.qualified) process.exitCode = 1;
