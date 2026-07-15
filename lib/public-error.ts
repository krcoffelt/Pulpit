export class PublicError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublicError";
    this.status = status;
  }
}

export function safeErrorMessage(error: unknown, fallback: string) {
  return error instanceof PublicError ? error.message : fallback;
}
