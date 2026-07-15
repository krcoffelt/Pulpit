import { NextResponse } from "next/server";
import OpenAI from "openai";
import { findBestClips, getDuration, transcribeSermon, withTempUpload } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function friendlyTitle(filename: string) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Add OPENAI_API_KEY to .env.local, then restart the app." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const suppliedTitle = String(form.get("title") || "").trim();
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a video or audio file to analyze." }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      return NextResponse.json({ error: "This local build accepts files up to 2 GB." }, { status: 413 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await withTempUpload(file, "pulpit-analysis-", async ({ sourcePath }) => {
      const duration = await getDuration(sourcePath);
      const transcript = await transcribeSermon(sourcePath, openai);
      const clips = await findBestClips(transcript, openai);
      return {
        title: suppliedTitle || friendlyTitle(file.name),
        duration,
        transcript,
        clips,
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sermon could not be analyzed.";
    console.error("Sermon analysis failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
