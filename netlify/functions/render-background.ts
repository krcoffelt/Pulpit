import type { Context } from "@netlify/functions";
import { z } from "zod";
import { runRenderJob } from "../../lib/render-worker";
import { logEvent } from "../../lib/log";

const inputSchema = z.object({
  projectId: z.string().regex(/^job-[a-f0-9-]{36}$/),
  exportId: z.string().regex(/^export-[a-f0-9-]{36}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

const handler = async (request: Request, context: Context) => {
  void context;
  const requestId = request.headers.get("x-circumvision-request-id") || crypto.randomUUID();
  try {
    const input = inputSchema.parse(await request.json());
    logEvent("info", "render.background_started", { requestId, projectId: input.projectId, exportId: input.exportId });
    await runRenderJob(input);
    logEvent("info", "render.background_completed", { requestId, projectId: input.projectId, exportId: input.exportId });
  } catch (error) {
    logEvent("error", "render.background_failed", { requestId }, error);
  }
};

export default handler;
