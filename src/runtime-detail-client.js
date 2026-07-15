import { KernelError } from "./errors.js";

export function createRuntimeDetailClient({ baseUrl, token, timeoutMs = 5_000 }) {
  if (!baseUrl || !token) throw new Error("Runtime detail adapter URL and token are required.");
  const root = baseUrl.replace(/\/$/, "");

  async function post(path, body) {
    let response;
    try {
      response = await fetch(`${root}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new KernelError(503, "RUNTIME_DETAIL_UNAVAILABLE", "Runtime detail adapter is unavailable.", {
        cause: error.name
      });
    }
    let result;
    try {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 512 * 1024) {
        throw new KernelError(502, "RUNTIME_DETAIL_TOO_LARGE", "Runtime detail response exceeds 512 KiB.");
      }
      result = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if (error instanceof KernelError) throw error;
      result = null;
    }
    if (!response.ok || !result || typeof result !== "object") {
      throw new KernelError(502, "RUNTIME_DETAIL_REJECTED", "Runtime detail adapter rejected the request.", {
        status: response.status
      });
    }
    return result;
  }

  return {
    retrieveExecutionDetail(input) {
      return post("/v0/execution-details:retrieve", input);
    },
    reproduce(input) {
      return post("/v0/reproductions:run", input);
    }
  };
}
