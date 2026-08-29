import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startArticleGameHost, type ArticleGameHost } from "./article-game-host";

const hosts: ArticleGameHost[] = [];
const temporaryRoots: string[] = [];

function rawStatus(url: string, requestPath: string): Promise<number> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: requestPath,
      method: "GET",
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("article game host", () => {
  it("serves nested game roots and rejects traversal", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xiaoman-article-host-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "pacman", "assets"), { recursive: true });
    writeFileSync(path.join(root, "pacman", "index.html"), "<html>pacman</html>");
    writeFileSync(path.join(root, "pacman", "assets", "board.txt"), "board");
    const host = await startArticleGameHost(root);
    hosts.push(host);

    await expect((await fetch(`${host.url}/pacman/`)).text()).resolves.toContain("pacman");
    await expect((await fetch(`${host.url}/pacman/assets/board.txt`)).text()).resolves.toBe("board");
    expect(await rawStatus(host.url, "/pacman/%2e%2e%2fsecret.txt")).toBe(403);
    expect((await fetch(`${host.url}/missing/index.html`)).status).toBe(404);
  });

  it("exposes a stable loopback base URL for iframe embedding", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xiaoman-article-host-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "2048"));
    writeFileSync(path.join(root, "2048", "index.html"), "<html>2048</html>");
    const host = await startArticleGameHost(root);
    hosts.push(host);

    expect(new URL(host.url).hostname).toBe("127.0.0.1");
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${host.url}/2048/index.html`)).status).toBe(200);
  });
});
