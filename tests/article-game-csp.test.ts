import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("article game frame policy", () => {
  it("allows only loopback article-game frames from the packaged renderer", () => {
    const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? "";

    expect(policy).toContain("frame-src 'self' http://127.0.0.1:* http://localhost:* http://47.97.219.242:18080");
    expect(policy).toContain("connect-src 'self' http: https: ws: wss:");
    expect(policy).not.toContain("frame-src *");
  });
});
