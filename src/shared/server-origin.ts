export const DEFAULT_XIAOMAN_SERVER_ORIGIN = "http://47.97.219.242:18080";

export interface XiaomanPageLocation {
  protocol: string;
  hostname: string;
  origin: string;
}

export function normalizeServerOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function serverOriginForPage(location?: XiaomanPageLocation | null): string {
  if (location && (location.protocol === "http:" || location.protocol === "https:")) {
    const hostname = location.hostname.toLowerCase();
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return normalizeServerOrigin(location.origin) ?? DEFAULT_XIAOMAN_SERVER_ORIGIN;
    }
  }
  return DEFAULT_XIAOMAN_SERVER_ORIGIN;
}

export function articleGameServerUrl(
  origin: string,
  gameId: string,
  entryPath = "index.html",
): string {
  const normalized = normalizeServerOrigin(origin);
  if (!normalized) throw new Error("游戏服务器地址无效");
  const safeEntry = entryPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${normalized}/article-games/${encodeURIComponent(gameId)}/${safeEntry}`;
}
