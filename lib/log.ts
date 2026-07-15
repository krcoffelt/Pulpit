type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, string | number | boolean | null | undefined>;

function errorDetails(error: unknown): LogContext {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const candidate = error as Error & { code?: unknown; status?: unknown; type?: unknown };
  return {
    errorName: error.name,
    errorMessage: error.message.slice(0, 500),
    errorCode: typeof candidate.code === "string" ? candidate.code.slice(0, 100) : undefined,
    errorStatus: typeof candidate.status === "number" ? candidate.status : undefined,
    errorType: typeof candidate.type === "string" ? candidate.type.slice(0, 100) : undefined,
  };
}

export function logEvent(level: LogLevel, event: string, context: LogContext = {}, error?: unknown) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: "circumvision",
    event,
    ...context,
    ...(error === undefined ? {} : errorDetails(error)),
  };
  if (level === "error") console.error(JSON.stringify(payload));
  else if (level === "warn") console.warn(JSON.stringify(payload));
  else console.info(JSON.stringify(payload));
}
