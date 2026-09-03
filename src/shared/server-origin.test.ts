import { describe, expect, it } from "vitest";
import {
  articleGameServerUrl,
  DEFAULT_XIAOMAN_SERVER_ORIGIN,
  serverOriginForPage,
} from "./server-origin";

describe("Xiaoman server origin", () => {
  it("uses the configured server for Electron and loopback previews", () => {
    expect(serverOriginForPage()).toBe(DEFAULT_XIAOMAN_SERVER_ORIGIN);
    expect(serverOriginForPage({
      protocol: "http:",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:5173",
    })).toBe(DEFAULT_XIAOMAN_SERVER_ORIGIN);
  });

  it("uses the deployed web page origin for hosted assets", () => {
    expect(serverOriginForPage({
      protocol: "http:",
      hostname: "47.97.219.242",
      origin: "http://47.97.219.242:18080",
    })).toBe("http://47.97.219.242:18080");
  });

  it("builds encoded game asset URLs", () => {
    expect(articleGameServerUrl(
      DEFAULT_XIAOMAN_SERVER_ORIGIN,
      "xiangqi-h5",
      "img/stype_2/bg.png",
    )).toBe("http://47.97.219.242:18080/article-games/xiangqi-h5/img/stype_2/bg.png");
  });
});
