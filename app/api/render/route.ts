import path from "node:path";
import { NextResponse } from "next/server";
import { renderClip, withTempUpload } from "@/lib/media";
import type { RenderSettings, TranscriptSegment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "The source video is required for export." }, { status: 400 });
    }

    const start = Number(form.get("start"));
    const end = Number(form.get("end"));
    const transcript = JSON.parse(String(form.get("transcript") || "[]")) as TranscriptSegment[];
    const settings = JSON.parse(String(form.get("settings") || "{}")) as RenderSettings;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 60.1) {
      return NextResponse.json({ error: "Export clips must be between 0.5 and 60 seconds." }, { status: 400 });
    }

    const output = await withTempUpload(file, "pulpit-render-", async ({ dir, sourcePath }) => {
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

    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="pulpit-short.mp4"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The clip could not be rendered.";
    console.error("Clip render failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
