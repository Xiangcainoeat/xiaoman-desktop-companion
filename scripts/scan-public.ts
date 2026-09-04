#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  "work",
  "tmp",
  ".cache",
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".mts", ".py", ".sh", ".toml", ".ts", ".tsx", ".txt", ".yml", ".yaml",
]);
const PRIVATE_MARKERS = [
  "/Users/zk",
  "/Library/Containers/",
  "RWTemp",
  "xwechat_files",
  "codex-clipboard-",
  "nbgpt-father",
];
const SECRET_ASSIGNMENT = /(?:OPENAI_API_KEY|PET_IMAGE_API_KEY|API_KEY)\s*[:=]\s*["']?([A-Za-z0-9_\-]{20,})/g;
const PLACEHOLDER = /^(?:your[-_ ]|replace[-_ ]|change[-_ ]|example|test|dummy|<)/i;

async function collectFiles(directory: string, result: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, result);
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push(fullPath);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const findings: string[] = [];
  for (const filePath of await collectFiles(root)) {
    if (path.resolve(filePath) === path.resolve(__filename)) continue;
    const info = await stat(filePath);
    if (info.size > 2 * 1024 * 1024) continue;
    const text = await readFile(filePath, "utf8");
    for (const marker of PRIVATE_MARKERS) {
      if (text.includes(marker)) findings.push(`${path.relative(root, filePath)}: private marker ${marker}`);
    }
    for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
      if (!PLACEHOLDER.test(match[1])) findings.push(`${path.relative(root, filePath)}: possible secret assignment`);
    }
  }
  if (findings.length > 0) {
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Public scan passed: no private markers or inline secrets found.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
