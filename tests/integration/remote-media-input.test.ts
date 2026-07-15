import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractAudioChunks, getDuration, hasVideoStream } from "@/lib/media";

const execFileAsync = promisify(execFile);
let directory = "";
let server: Server;
let sourceUrl = "";
let fixture = Buffer.alloc(0);
let rangedRequests = 0;
const accessToken = "stream-test-token";

beforeAll(async () => {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable.");
  directory = await mkdtemp(path.join(tmpdir(), "circumvision-remote-media-"));
  const fixturePath = path.join(directory, "fixture.mp4");
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x24130f:s=320x180:d=2.2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2.2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", fixturePath,
  ]);
  fixture = await readFile(fixturePath);

  server = createServer((request, response) => {
    if (request.headers["x-circumvision-test-token"] !== accessToken) {
      response.writeHead(403).end();
      return;
    }
    const range = request.headers.range;
    if (!range) {
      response.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": fixture.byteLength, "Content-Type": "video/mp4" });
      response.end(fixture);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${fixture.byteLength}` }).end();
      return;
    }
    rangedRequests += 1;
    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : fixture.byteLength - 1, fixture.byteLength - 1);
    const body = fixture.subarray(start, end + 1);
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": body.byteLength,
      "Content-Range": `bytes ${start}-${end}/${fixture.byteLength}`,
      "Content-Type": "video/mp4",
    });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  sourceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media`;
});

afterAll(async () => {
  server?.close();
  if (server) await once(server, "close");
  await rm(directory, { recursive: true, force: true });
});

describe("remote media input", () => {
  it("probes and extracts audio through authenticated HTTP ranges", async () => {
    const headers = { "X-Circumvision-Test-Token": accessToken };
    await expect(getDuration(sourceUrl, headers)).resolves.toBeCloseTo(2.2, 1);
    await expect(hasVideoStream(sourceUrl, headers)).resolves.toBe(true);
    const audioDirectory = await mkdtemp(path.join(directory, "audio-"));
    const chunks = await extractAudioChunks(sourceUrl, audioDirectory, 1, headers);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(rangedRequests).toBeGreaterThan(0);
  });
});
