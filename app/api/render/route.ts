import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { renderClip, withTempUpload } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const transcriptSchema = z.array(z.object({
  id: z.string().min(1).max(120),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  text: z.string().min(1).max(4_000),
  speaker: z.string().min(1).max(180),
})).max(20_000);

const settingsSchema = z.object({
  aspect: z.enum(["9:16", "4:5", "1:1"]).default("9:16"),
  captionPreset: z.enum(["bold", "clean", "minimal"]).default("bold"),
  captionPosition: z.enum(["middle", "bottom"]).default("bottom"),
  captionScale: z.number().finite().min(0.7).max(1.35).default(1),
  captionsEnabled: z.boolean().default(true),
  highlight: z.boolean().default(true),
  frameMode: z.enum(["fill", "fit"]).default("fill"),
});

function parseJsonField(value: FormDataEntryValue | null, label: string) {
  try {
    return JSON.parse(String(value || "")) as unknown;
  } catch {
    throw new Error(`${label} data was not valid JSON.`);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  let stage = "reading upload";

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "The source video is required for export.", requestId }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "This local build accepts files up to 2 GB.", requestId }, { status: 413 });
    }

    stage = "validating settings";
    const start = Number(form.get("start"));
    const end = Number(form.get("end"));
    const transcript = transcriptSchema.parse(parseJsonField(form.get("transcript"), "Transcript"));
    const settings = settingsSchema.parse(parseJsonField(form.get("settings"), "Render settings"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start < 0.5 || end - start > 60.1) {
      return NextResponse.json({ error: "Export clips must be between 0.5 and 60 seconds.", requestId }, { status: 400 });
    }

    console.info("[api/render] request accepted", { requestId, bytes: file.size, start, end, aspect: settings.aspect });
    stage = "rendering clip";
    const output = await withTempUpload(file, "circumvision-render-", async ({ dir, sourcePath }) => {
      return renderClip({
        sourcePath,
        outputPath: path.join(dir, "short.mp4"),
        subtitlePath: path.join(dir, "captions.ass"),
        start,
        end,
        transcript,
        aspect: settings.aspect || "9:16",
        captionPreset: settings.captionPreset || "bold",
        captionPosition: settings.captionPosition || "bottom",
        captionScale: settings.captionScale || 1,
        captionsEnabled: settings.captionsEnabled !== false,
        highlight: settings.highlight !== false,
        frameMode: settings.frameMode || "fill",
      });
    });

    console.info("[api/render] complete", { requestId, bytes: output.byteLength });
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="circumvision-short.mp4"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const validationError = error instanceof z.ZodError;
    const message = validationError
      ? error.issues[0]?.message || "The render settings were invalid."
      : error instanceof Error ? error.message : "The clip could not be rendered.";
    console.error("[api/render] failed", { requestId, stage, message, error });
    return NextResponse.json({ error: `${stage[0].toUpperCase()}${stage.slice(1)} failed: ${message}`, requestId }, { status: validationError ? 400 : 500 });
  }
}
