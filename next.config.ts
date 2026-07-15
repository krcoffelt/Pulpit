import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;
