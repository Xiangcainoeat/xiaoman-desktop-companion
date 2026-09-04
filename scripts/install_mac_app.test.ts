import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installer = readFileSync(new URL("./install_mac_app.sh", import.meta.url), "utf8");

describe("macOS app installer", () => {
  it("finds suffixed backup bundles before refreshing LaunchServices", () => {
    expect(installer).toContain("unregister_duplicate_app");
    expect(installer).toContain("*/Contents/Info.plist");
    expect(installer).toContain("/private/tmp");
  });
});
