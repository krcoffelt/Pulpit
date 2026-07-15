import { execFileSync } from "node:child_process";

const requiredFiles = [
  "app/api/projects/[projectId]/exports/route.ts",
  "app/api/projects/[projectId]/exports/[exportId]/route.ts",
  "app/api/projects/[projectId]/exports/[exportId]/media/route.ts",
  "netlify/functions/process-background.ts",
  "netlify/functions/render-background.ts",
];

try {
  execFileSync("git", ["ls-files", "--error-unmatch", ...requiredFiles], {
    stdio: "ignore",
  });
} catch {
  console.error("Release-critical files are missing from Git. Check .gitignore before deploying:");
  for (const file of requiredFiles) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Verified ${requiredFiles.length} release-critical files are tracked by Git.`);
