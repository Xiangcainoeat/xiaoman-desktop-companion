import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OverviewView.tsx", import.meta.url), "utf8");

describe("OverviewView care separation contract", () => {
  it("keeps overview actions focused on ordinary interaction", () => {
    expect(source).not.toContain('action: "feed"');
    expect(source).toContain('action: "pet"');
    expect(source).toContain('action: "play"');
  });

  it("offers a read-only care handoff instead of duplicating care controls", () => {
    expect(source).toContain("onOpenCare");
    expect(source).toContain("overview-care-handoff");
    expect(source).toContain('打开照料');
    expect(source).not.toContain("bridge.feedFood");
    expect(source).not.toContain("bridge.bathePet");
    expect(source).not.toContain("bridge.startPetJob");
  });
});
