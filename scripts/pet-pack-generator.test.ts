import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OpenAICompatibleImageProvider,
  runGenerationPlan,
  type ImageApiResponse,
  type ImageGenerationProvider,
} from "./pet-pack-generator";
import {
  buildJobsManifest,
  createReferenceMetadata,
} from "./pet-pack-prompts";

function response(payload: unknown): ImageApiResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("Pet Pack image generation", () => {
  it("keeps provider requests bounded, writes atomically, and skips existing frames", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pet-pack-generator-"));
    try {
      const reference = path.join(root, "reference.png");
      await writeFile(reference, "reference");
      const references = createReferenceMetadata([{ path: reference, role: "identity" }]);
      const plan = buildJobsManifest({ assetId: "test-cat", actions: ["idle-blink"], references, concurrency: 4 });
      let active = 0;
      let maxActive = 0;
      const provider: ImageGenerationProvider = {
        generate: async ({ job }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return new Uint8Array([job.frameIndex, 1, 2]);
        },
      };

      const first = await runGenerationPlan(plan, provider, { projectDir: root, concurrency: 4 });
      expect(first).toMatchObject({ attempted: 30, completed: 30, skipped: 0, failed: 0, maxActive: 4 });
      expect(maxActive).toBe(4);
      expect(await readFile(path.join(root, plan.jobs[0].outputPath))).toEqual(Buffer.from([0, 1, 2]));

      const second = await runGenerationPlan(plan, provider, { projectDir: root, concurrency: 4 });
      expect(second).toMatchObject({ attempted: 0, completed: 0, skipped: 30, failed: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports individual provider failures without leaving partial files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pet-pack-generator-fail-"));
    try {
      const reference = path.join(root, "reference.png");
      await writeFile(reference, "reference");
      const references = createReferenceMetadata([{ path: reference }]);
      const plan = buildJobsManifest({ assetId: "test-cat", actions: ["avatar"], references });
      const provider: ImageGenerationProvider = {
        generate: async () => { throw new Error("provider unavailable"); },
      };
      const result = await runGenerationPlan(plan, provider, { projectDir: root });
      expect(result).toMatchObject({ attempted: 1, completed: 0, skipped: 0, failed: 1 });
      expect(result.failures[0]).toMatchObject({ jobId: plan.jobs[0].id, outputPath: plan.jobs[0].outputPath });
      await expect(readFile(path.join(root, plan.jobs[0].outputPath))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sends multi-reference prompts to an OpenAI-compatible endpoint and decodes base64", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pet-pack-provider-"));
    try {
      const identity = path.join(root, "identity.png");
      const body = path.join(root, "body.jpg");
      await writeFile(identity, "identity-bytes");
      await writeFile(body, "body-bytes");
      const references = createReferenceMetadata([
        { path: identity, role: "identity" },
        { path: body, role: "body" },
      ]);
      const plan = buildJobsManifest({ assetId: "test-cat", actions: ["avatar"], references });
      let requestUrl = "";
      let requestInit: { headers?: Record<string, string>; body?: string } | undefined;
      const provider = new OpenAICompatibleImageProvider({
        endpoint: "https://image.example/v1",
        apiKey: "secret-key",
        model: "test-image-model",
        projectDir: root,
        fetchImpl: async (url, init) => {
          requestUrl = url;
          requestInit = init;
          return response({ data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }] });
        },
      });

      const bytes = await provider.generate({ job: plan.jobs[0], projectDir: root, references });
      expect(Buffer.from(bytes)).toEqual(Buffer.from("png-bytes"));
      expect(requestUrl).toBe("https://image.example/v1/images/generations");
      expect(requestInit?.headers?.Authorization).toBe("Bearer secret-key");
      const sent = JSON.parse(requestInit?.body ?? "{}") as {
        model?: string;
        size?: string;
        reference_images?: Array<{ role: string; data: string }>;
      };
      expect(sent).toMatchObject({ model: "test-image-model", size: "128x128" });
      expect(sent.reference_images).toHaveLength(2);
      expect(sent.reference_images?.[0].role).toBe("identity");
      expect(sent.reference_images?.[0].data).toContain("data:image/png;base64,");
      expect(sent.reference_images?.[1].data).toContain("data:image/jpeg;base64,");
      expect(sent.reference_images?.[0].data).toContain(Buffer.from("identity-bytes").toString("base64"));
      expect(createHash("sha256").update("identity-bytes").digest("hex")).toBe(references[0].sha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
