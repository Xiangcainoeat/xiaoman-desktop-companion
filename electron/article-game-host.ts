import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";

export interface ArticleGameHost {
  url: string;
  close(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function resolveSafePath(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  // Reject traversal segments before path.resolve normalizes them into an
  // apparently valid path inside the host root.
  if (decoded.split("/").some((segment) => segment === "..")) return null;
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const relative = path.relative(rootPath, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return candidate;
}

async function serveFile(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    sendText(response, 400, "Bad Request");
    return;
  }

  const candidate = resolveSafePath(root, pathname);
  if (!candidate) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const rootReal = await fs.realpath(root);
    let filePath = candidate;
    if ((await fs.stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
    const fileReal = await fs.realpath(filePath);
    const relative = path.relative(rootReal, fileReal);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      sendText(response, 403, "Forbidden");
      return;
    }
    const body = await fs.readFile(fileReal);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[path.extname(fileReal).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": body.byteLength,
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") sendText(response, 404, "Not Found");
    else {
      console.warn(`[xiaoman] failed to serve article game asset: ${String(error)}`);
      sendText(response, 500, "Internal Server Error");
    }
  }
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Article game host did not receive a TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });
}

function closeServer(server: Server, sockets: Set<net.Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export async function startArticleGameHost(root: string): Promise<ArticleGameHost> {
  if (!existsSync(root)) throw new Error(`文章游戏资源目录不存在：${root}`);
  const sockets = new Set<net.Socket>();
  const server = createServer((request, response) => {
    void serveFile(root, request, response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const port = await listenOnLoopback(server);
  let closed = false;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await closeServer(server, sockets);
    },
  };
}
