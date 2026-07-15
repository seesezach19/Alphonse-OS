import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize } from "./canonical-json.js";
import { verifyVerificationReceiptSignature } from "./diagnostic-verification-contracts.js";
import { KernelError } from "./errors.js";

const DEFAULT_PROCESS = fileURLToPath(new URL("./verification-runner-process.js", import.meta.url));

function bounded(value, field, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

export function createVerificationRunnerClient({
  keyId, signingSecret, timeoutMs = 15_000, processPath = DEFAULT_PROCESS
}) {
  const runnerKeyId = bounded(keyId, "keyId", 160);
  const secret = bounded(signingSecret, "signingSecret");
  if (secret.length < 32) throw new Error("signingSecret must contain at least 32 characters.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("timeoutMs is outside the supported range.");
  }

  async function verify(job) {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "alphonse-verification-"));
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [processPath], {
          cwd: workspace,
          env: {
            PATH: process.env.PATH ?? "",
            SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
            TEMP: workspace,
            TMP: workspace,
            ALPHONSE_VERIFICATION_SIGNING_KEY_ID: runnerKeyId,
            ALPHONSE_VERIFICATION_SIGNING_SECRET: secret
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
        const stdout = [];
        const stderr = [];
        let outputBytes = 0;
        const timer = setTimeout(() => {
          child.kill();
          reject(new KernelError(504, "VERIFICATION_RUNNER_TIMEOUT",
            "Verification Runner exceeded its deterministic execution limit."));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > 5 * 1024 * 1024) child.kill();
          else stdout.push(chunk);
        });
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(new KernelError(502, "VERIFICATION_RUNNER_UNAVAILABLE",
            "Verification Runner process could not start.", { error_name: error.name }));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0 || outputBytes > 5 * 1024 * 1024) {
            return reject(new KernelError(502, "VERIFICATION_RUNNER_FAILED",
              "Verification Runner process failed closed.", {
                exit_code: code,
                stderr_present: Buffer.concat(stderr).length > 0
              }));
          }
          try {
            resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
          } catch {
            reject(new KernelError(502, "VERIFICATION_RUNNER_OUTPUT_INVALID",
              "Verification Runner returned invalid output."));
          }
        });
        child.stdin.end(canonicalize(job));
      });
      verifyVerificationReceiptSignature(result.receipt, { keyId: runnerKeyId, secret });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
    return {
      receipt: result.receipt,
      logs: result.logs,
      environment: {
        process_id: result.process_id,
        disposable: true,
        workspace_destroyed: true,
        production_credentials_received: false
      }
    };
  }

  return { verify };
}
