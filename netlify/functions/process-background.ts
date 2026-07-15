import type { Context } from "@netlify/functions";
import { z } from "zod";
import { runProcessJob } from "../../lib/process-worker";
import { logEvent } from "../../lib/log";

const inputSchema = z.object({
  projectId: z.string().regex(/^job-[a-f0-9-]{36}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

const handler = async (request: Request, context: Context) => {
  void context;
  const requestId = request.headers.get("x-circumvision-request-id") || crypto.randomUUID();
  try {
    const input = inputSchema.parse(await request.json());
    logEvent("info", "process.background_started", { requestId, projectId: input.projectId });
    await runProcessJob(input);
    logEvent("info", "process.background_completed", { requestId, projectId: input.projectId });
  } catch (error) {
    logEvent("error", "process.background_failed", { requestId }, error);
  }
};

export default handler;
