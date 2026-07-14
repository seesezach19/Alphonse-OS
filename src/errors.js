export class KernelError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "KernelError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
