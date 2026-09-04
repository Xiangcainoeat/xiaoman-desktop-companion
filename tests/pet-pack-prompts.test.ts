import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ACTION_NAMES,
  ACTION_TEMPLATES,
  buildJobsManifest,
  createReferenceMetadata,
  getConcurrency,
  renderPromptsJson,
  renderPromptsMarkdown,
} from "../scripts/pet-pack-prompts";
import { generate, init, pack, prompts, validate } from "../scripts/pet-pack-cli";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "pet-pack-test-"));
}

describe("Pet Pack action prompt contracts", () => {
  it("provides every required action with stable generation fields", () => {
    expect(ACTION_NAMES).toEqual([
      "standard",
      "look-atlas",
      "idle-lick",
      "idle-blink",
      "idle-scratch",
      "sleeping",
      "care-feed",
      "care-bath",
      "running-left",
      "running-right",
      "jumping",
      "avatar",
      "tray",
    ]);

    for (const actionName of ACTION_NAMES) {
      const action = ACTION_TEMPLATES[actionName];
      expect(action.prompt.length).toBeGreaterThan(20);
      expect(action.negativePrompt.length).toBeGreaterThan(10);
      expect(action.frameCount).toBeGreaterThan(0);
      expect(action.canvas.width).toBeGreaterThan(0);
      expect(action.canvas.height).toBeGreaterThan(0);
      expect(typeof action.transparentBackground).toBe("boolean");
      expect(action.referenceRoles.length).toBeGreaterThan(0);
    }

    expect(ACTION_TEMPLATES["idle-lick"]).toEqual(ACTION_TEMPLATES["idle-lick"]);
    expect(renderPromptsMarkdown(ACTION_TEMPLATES)).toContain("## idle-lick");
  });

  it("hashes multiple references without copying them and keeps their roles", () => {
    const root = temporaryDirectory();
    try {
      const front = join(root, "front.jpg");
      const body = join(root, "body.jpg");
      writeFileSync(front, "front-reference");
      writeFileSync(body, "body-reference");

      const references = createReferenceMetadata([
        { path: front, role: "identity" },
        { path: body, role: "body" },
      ]);

      expect(references).toEqual([
        {
          path: front,
          sha256: createHash("sha256").update("front-reference").digest("hex"),
          role: "identity",
        },
        {
          path: body,
          sha256: createHash("sha256").update("body-reference").digest("hex"),
          role: "body",
        },
      ]);
      expect(existsSync(join(root, "public"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds deterministic frame jobs under the author workspace frames path", () => {
    const references = [
      { path: "/private/refs/front.jpg", sha256: "a".repeat(64), role: "identity" },
    ];
    const manifest = buildJobsManifest({
      assetId: "my-cat",
      actions: ["idle-blink", "avatar"],
      references,
    });

    expect(manifest.jobs).toHaveLength(
      ACTION_TEMPLATES["idle-blink"].frameCount + ACTION_TEMPLATES.avatar.frameCount,
    );
    expect(manifest.jobs[0]).toMatchObject({
      assetId: "my-cat",
      action: "idle-blink",
      frameIndex: 0,
      outputPath: "frames/my-cat/idle-blink-000.png",
      prompt: ACTION_TEMPLATES["idle-blink"].prompt,
      negativePrompt: ACTION_TEMPLATES["idle-blink"].negativePrompt,
      references,
    });
    expect(manifest.jobs.at(-1)?.outputPath).toBe("frames/my-cat/avatar-000.png");
    expect(manifest.jobs[0].id).toMatch(/^my-cat-idle-blink-000-[a-f0-9]{12}$/);
    expect(renderPromptsJson(ACTION_TEMPLATES)).toContain('"idle-blink"');
  });

  it("defaults concurrency to three and rejects values above the hard limit", () => {
    expect(getConcurrency(undefined)).toBe(3);
    expect(getConcurrency("6")).toBe(6);
    expect(() => getConcurrency("7")).toThrow(/concurrency.*6/i);
    expect(() => getConcurrency("0")).toThrow(/concurrency/i);
    expect(() => getConcurrency("not-a-number")).toThrow(/concurrency/i);
  });
});

describe("Pet Pack CLI dry-run workflow", () => {
  it("initializes a workspace, writes prompt artifacts, and creates jobs.json without an API key", async () => {
    const root = temporaryDirectory();
    const workspace = join(root, "my-cat");
    const reference = join(root, "reference.png");
    writeFileSync(reference, "not-a-real-image-but-a-reference-file");

    try {
      await init({
        workspace,
        name: "My Cat",
        assetId: "my-cat",
        references: [{ path: reference, role: "identity" }],
      });

      expect(JSON.parse(readFileSync(join(workspace, "pet-project.json"), "utf8"))).toMatchObject({
        assetId: "my-cat",
        displayName: "My Cat",
      });

      await prompts({ project: workspace });
      expect(readFileSync(join(workspace, "prompts", "pet-pack.md"), "utf8")).toContain("idle-blink");
      expect(JSON.parse(readFileSync(join(workspace, "prompts", "pet-pack.json"), "utf8"))).toHaveProperty("standard");

      const result = await generate({ project: workspace, concurrency: 3 });
      expect(result.dryRun).toBe(true);
      expect(result.apiKeyRequired).toBe(false);
      const jobs = JSON.parse(readFileSync(join(workspace, "jobs.json"), "utf8"));
      expect(jobs.jobs.length).toBeGreaterThan(0);
      expect(jobs.jobs[0].outputPath).toMatch(/^frames\/my-cat\/[a-z0-9-]+-\d{3}\.png$/);
      expect(existsSync(join(workspace, "public"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates the manifest and every declared file in a .xmpet archive", async () => {
    const root = temporaryDirectory();
    const workspace = join(root, "my-cat");
    const reference = join(root, "reference.png");
    writeFileSync(reference, "reference");

    try {
      await init({
        workspace,
        name: "My Cat",
        assetId: "my-cat",
        references: [{ path: reference, role: "identity" }],
      });
      await prompts({ project: workspace });
      await generate({ project: workspace });
      mkdirSync(join(workspace, "assets", "codex"), { recursive: true });
      writeFileSync(join(workspace, "assets", "codex", "pet.json"), "{}");
      writeFileSync(join(workspace, "assets", "codex", "spritesheet.webp"), "sprite");
      const packageFile = join(root, "my-cat.xmpet");
      await pack({ project: workspace, output: packageFile });

      const result = await validate({ packageFile });
      expect(result.entries).toBeGreaterThanOrEqual(3);
      expect(result.manifestId).toBe("my-cat");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
