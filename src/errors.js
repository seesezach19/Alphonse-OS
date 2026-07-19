// @ts-check

export class KernelError extends Error {
  /**
   * @param {number} status HTTP status the error maps to at the boundary.
   * @param {string} code Stable machine-readable issue code (e.g. "INVALID_INPUT").
   * @param {string} message Human-readable explanation.
   * @param {Record<string, unknown>} [details] Structured, non-sensitive context.
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "KernelError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
