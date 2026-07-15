import { signVerificationReceipt } from "./diagnostic-verification-contracts.js";
import { runN8nDeterministicVerification } from
  "../packages/n8n-operational-package/src/verification-adapter.js";

const keyId = process.env.ALPHONSE_VERIFICATION_SIGNING_KEY_ID;
const secret = process.env.ALPHONSE_VERIFICATION_SIGNING_SECRET;
if (!keyId || !secret) throw new Error("Verification signing identity is required.");

let bytes = 0;
const chunks = [];
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 5 * 1024 * 1024) throw new Error("Verification job exceeds process input limit.");
  chunks.push(chunk);
}

const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const result = runN8nDeterministicVerification(job);
const receipt = signVerificationReceipt(result.receipt, { keyId, secret });
process.stdout.write(JSON.stringify({ receipt, logs: result.logs, process_id: process.pid }));
