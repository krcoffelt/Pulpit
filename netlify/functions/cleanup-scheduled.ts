import type { Config, Context } from "@netlify/functions";
import { cleanupExpiredData } from "../../lib/cleanup";
import { logEvent } from "../../lib/log";

export const config: Config = { schedule: "@daily" };

const handler = async (_request: Request, context: Context) => {
  const requestId = context.requestId || crypto.randomUUID();
  try {
    const result = await cleanupExpiredData();
    return Response.json({ ok: true, requestId, ...result });
  } catch (error) {
    logEvent("error", "cleanup.failed", { requestId }, error);
    return Response.json({ ok: false, requestId }, { status: 500 });
  }
};

export default handler;
