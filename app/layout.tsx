import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Pulpit Studio — Sermon Clip Editor",
  description: "Turn full sermons into captioned, platform-ready short-form video.",
  applicationName: "Pulpit Studio",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/app-icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Pulpit Studio",
    description: "Turn full sermons into captioned, platform-ready short-form video.",
    type: "website",
    images: [
      {
        url: "/brand/pulpit-social-icon.png",
        width: 1200,
        height: 1200,
        alt: "Pulpit Studio brand mark",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Pulpit Studio",
    description: "Turn full sermons into captioned, platform-ready short-form video.",
    images: ["/brand/pulpit-social-icon.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
