# 小满 Pet Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manifest-driven `.xmpet` authoring/runtime format, prompt-generation workflow, safe desktop import/switching, Codex synchronization, and a clean public GitHub release without exposing private references or secrets.

**Architecture:** Keep the existing bundled Xiaoman assets as the immutable fallback. Add a small shared `src/pet-pack/` contract/validator and an Electron main-process `PetPackService` that owns filesystem access, ZIP extraction, checksum validation, atomic activation, and Codex export. The renderer receives a resolved asset URL map through IPC and falls back to the bundled relative URLs in browser-only mode; the authoring CLI creates prompt/job manifests and packages already-validated output without calling an image API unless explicitly requested.

**Tech Stack:** TypeScript 6, React 19, Electron 44, Vite 8, Vitest 4, Node `fs`/`crypto`/`child_process`, existing Python/Pillow hatch-pet scripts, macOS `zip`/`unzip` only for the desktop distribution path.

**Spec:** `docs/superpowers/specs/2026-08-30-xiaoman-pet-pack-design.md`

## Global Constraints

- Runtime package schema is `schemaVersion: 1`; Codex runtime remains exactly `pet.json` plus `spritesheet.webp`.
- Standard atlas is `1536x2288`, 8x11 cells, each cell `192x208`.
- Enhanced gaze atlas is optional, 96 frames, 3.75 degrees; no transparency blending.
- Optional 30-frame action atlases use the existing `10xN` layouts and metadata contracts.
- User references, raw model outputs, API keys, private relay URLs and private logs never enter the runtime package or public Git history.
- Import rejects absolute paths, `..` traversal, oversized archives, malformed JSON, invalid images and checksum mismatches; failed imports leave the active profile unchanged.
- Generation concurrency is clamped to `1..6`, defaults to `3`, and dry-run mode never needs an API key.
- Custom files live under `~/Library/Application Support/小满桌面伴侣/pets/<pet-id>/`; application bundle files are never overwritten.
- Public repository creation uses a clean initial history; unlicensed third-party game snapshots are excluded or converted to explicit optional downloads before push.

### Task 1: Add the shared Pet Pack contract and validator

**Files:**
- Create: `src/pet-pack/types.ts`
- Create: `src/pet-pack/manifest.ts`
- Create: `src/pet-pack/validate.ts`
- Create: `src/pet-pack/manifest.test.ts`
- Modify: `src/shared/types.ts` only if a persisted `activePetPackId` field is needed

**Interfaces:**
- `PetPackManifest` represents the schema in the spec and includes `profiles`, `assets`, and `checksums`.
- `validatePetPackManifest(value: unknown): PetPackValidationResult` validates schema, IDs, relative paths, geometry, required assets and profile references without touching the filesystem.
- `validatePetPackDirectory(root: string): Promise<PetPackValidationResult>` validates manifest references, SHA-256 files, image dimensions/decodability through a small injectable decoder boundary, and returns structured errors/warnings.
- `buildFileChecksums(root: string, relativePaths: string[]): Promise<Record<string,string>>` produces sorted SHA-256 entries.

- [ ] Write tests for valid Xiaoman manifest, missing required asset, traversal path, wrong frame geometry, unknown schema, and checksum mismatch.
- [ ] Run `npx vitest run src/pet-pack/manifest.test.ts`; confirm the new tests fail because the module does not exist.
- [ ] Implement pure schema/path validation and deterministic checksum helpers.
- [ ] Run the focused tests and then `npm run typecheck`.
- [ ] Commit `feat: add xmpet manifest contract and validation`.

### Task 2: Build the prompt/job authoring CLI

**Files:**
- Create: `scripts/pet-pack-cli.ts`
- Create: `scripts/pet-pack-prompts.ts`
- Create: `scripts/pet-pack-cli.test.ts`
- Create: `templates/pet-pack/prompts/identity-lock.md`
- Create: `templates/pet-pack/prompts/actions/*.md` for standard, gaze, idle, sleep, feed and bath jobs
- Modify: `package.json` and `package-lock.json` to add `pet:init`, `pet:prompts`, `pet:generate`, `pet:validate`, `pet:pack`, and `pet:install` scripts

**Interfaces:**
- `parsePetPackCli(argv: string[]): PetPackCliOptions` rejects concurrency above 6 and defaults it to 3.
- `createPetProject(options): Promise<PetProjectSummary>` copies references into a private project folder, writes `pet-project.json`, and never copies files into a public path.
- `compilePetPrompts(projectDir): Promise<string[]>` writes one prompt per asset/job with reference roles, frame geometry, action semantics and the canonical identity path.
- `createGenerationPlan(projectDir): Promise<GenerationPlan>` writes `imagegen-jobs.json` with dependency edges and a dry-run-safe provider config.
- `runGenerationPlan(plan, provider): Promise<GenerationReport>` requires explicit `--provider`, uses an in-process semaphore capped at 6, and reports a clear missing-key error before any request.

- [ ] Write CLI tests for multiple references, prompt output paths, dry-run no-network behavior, concurrency clamping/rejection, and secret redaction.
- [ ] Run focused tests and observe the expected missing-module failures.
- [ ] Implement the CLI around existing `codex-pet/scripts/` deterministic tools; do not duplicate atlas assembly logic.
- [ ] Run a temporary-project dry run and assert no reference leaves the project directory and no secret is written.
- [ ] Commit `feat: add pet pack prompt and generation workflow`.

### Task 3: Add deterministic pack creation and safe extraction

**Files:**
- Create: `scripts/pet-pack-package.ts`
- Create: `scripts/pet-pack-package.test.ts`
- Create: `electron/pet-pack-service.ts`
- Create: `electron/pet-pack-service.test.ts`
- Modify: `scripts/install_mac_app.sh` only if public-packaging cleanup needs a shared helper

**Interfaces:**
- `packPetProject(projectDir: string, outputFile: string): Promise<PackReport>` validates the project, fills sorted checksums, writes a staging tree and creates a `.xmpet` ZIP.
- `inspectArchiveEntries(entries: string[]): { ok: true } | { ok: false; errors: string[] }` rejects absolute, traversal, duplicate and unsupported entries before extraction.
- `PetPackService.importPackage(packageFile): Promise<PetPackSummary>` extracts to a temporary directory under userData, validates, then atomically activates it under `userData/pets/<id>`.
- `PetPackService.listInstalled(): Promise<PetPackSummary[]>`, `getActive(): Promise<PetPackSummary | null>`, `setActive(id): Promise<PetPackSummary>`, and `remove(id): Promise<void>` expose only validated packages.
- `PetPackService.exportCodex(id, codexHome?): Promise<{path:string; files:string[]}>` copies only the two Codex files and preserves the existing target in a timestamped backup.

- [ ] Write tests for round-trip pack/unpack, traversal rejection, duplicate entries, invalid manifest, checksum mismatch, atomic failure rollback and Codex two-file export.
- [ ] Run focused tests and observe failures before implementation.
- [ ] Implement archive listing with the system ZIP tools used by the macOS app, bounded extraction, temporary directories and atomic rename.
- [ ] Run round-trip tests against a temporary directory and inspect the resulting archive entries.
- [ ] Commit `feat: package and safely install xmpet archives`.

### Task 4: Wire Electron IPC and persisted active-pack state

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/electron.d.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/useCompanion.ts`
- Create: `electron/pet-pack-ipc.test.ts`

**Interfaces:**
- IPC methods: `pet-pack:list`, `pet-pack:active`, `pet-pack:import`, `pet-pack:activate`, `pet-pack:remove`, `pet-pack:export-codex`, and `pet-pack:asset-url`.
- `pet-pack:asset-url` accepts a validated asset ID/profile and returns a file URL or bundled fallback URL; it never accepts an arbitrary renderer path.
- Snapshot includes `activePetPackId` and a compact `petPacks` list; old persisted data normalizes to the bundled pack.
- An activation broadcasts `pet-pack:changed` and causes PetSprite/ControlCenter consumers to reload URLs without restarting the app.

- [ ] Add IPC contract tests for valid IDs, malformed arguments, unknown pack IDs, and broadcast after activation.
- [ ] Run the focused tests and verify they fail before wiring.
- [ ] Add the service to app startup, normalize persisted state, expose typed preload methods and send asset URLs.
- [ ] Run Electron IPC, store migration and typecheck suites.
- [ ] Commit `feat: expose pet pack import and activation over ipc`.

### Task 5: Make the renderer consume dynamic Pet Pack assets

**Files:**
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/components/ControlCenter.tsx`
- Modify: `src/components/ActionPreview.tsx`
- Modify: `src/components/SettingsView.tsx`
- Create: `src/components/PetPackView.tsx`
- Create: `src/components/PetPackView.test.tsx`
- Modify: `src/App.tsx` and `src/styles.css`

**Interfaces:**
- `usePetPackAssets()` returns `{ active, assets, loading, error, importPackage, activate, exportCodex, remove }` and uses the bundled relative URLs in browser-only mode.
- `PetSprite` receives resolved asset URLs while retaining the existing native/enhanced profile behavior and all current animation row contracts.
- The new “宠物包” settings section supports import, activate, remove, and “同步到 Codex”; it shows missing optional enhanced assets as explicit fallback status.
- The UI displays the complete material checklist with target path, dimensions, action, required/optional state and validation status.

- [ ] Write renderer tests for the checklist, import error display, active-pack persistence state, and fallback when optional assets are absent.
- [ ] Run focused tests and observe failures.
- [ ] Replace hardcoded asset roots with the hook’s validated URL map; keep browser mock fallback working.
- [ ] Add the settings UI and styles using existing type tokens and no nested cards.
- [ ] Run all renderer tests and browser smoke checks for idle, gaze, sleep, care and native profile switching.
- [ ] Commit `feat: load custom pet packs in the desktop host`.

### Task 6: Curate the public repository and documentation

**Files:**
- Modify: `README.md`
- Modify: `ASSETS_LICENSE.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `docs/DELIVERY.md`
- Modify: `docs/DEVELOPMENT.md`
- Create: `docs/PET-PACK.md`
- Create: `docs/PET-ASSET-MANIFEST.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Modify: `.gitignore`

**Interfaces:**
- README starts with the macOS desktop-pet description and feature list, then links to installation, Pet Pack creation, asset mapping, privacy and licensing.
- `docs/PET-ASSET-MANIFEST.md` is generated from the canonical manifest and contains every asset/action target path.
- CI runs `npm ci`, typecheck, tests, schema validation, package round-trip checks and secret/path scans without an image API.
- Release workflow builds unsigned arm64 artifacts only on a manual/tagged run; binaries are GitHub Release assets, never Git blobs.

- [ ] Add documentation tests that verify the README names the desktop pet, lists core functions and links to the Pet Pack guide.
- [ ] Run the docs tests and confirm their initial failures.
- [ ] Write the public docs, add sanitized sample pack and previews, remove private/oversized work artifacts from the publication staging tree, and record every third-party license decision.
- [ ] Run a clean-clone dry build and a repository secret/path audit.
- [ ] Commit `docs: document public pet pack workflow and release boundary`.

### Task 7: Create and push the public GitHub repository

**Files:**
- Create outside the current dirty history: `/tmp/xiaoman-desktop-companion-public/` as a curated clean export, then publish its contents to the GitHub repository.

- [ ] Build a clean export containing source, final public assets, `codex-pet`, prompts/templates, tests, docs and license files; exclude original photos, raw outputs, local logs, `release/`, private `work/` data and unresolved third-party game snapshots.
- [ ] Run `git init`, `npm ci`, typecheck, tests and a production build inside the clean export.
- [ ] Create `Xiangcainoeat/xiaoman-desktop-companion` as a public repository with `gh repo create --public` and set `origin`.
- [ ] Push the clean initial commit, then create a GitHub Release containing the generated arm64 DMG/ZIP if the license audit passes.
- [ ] Clone the public repository into a second temporary directory and rerun the no-secret scan, tests and package validation.
- [ ] Commit or tag the final release metadata and record the public URL in `docs/DELIVERY.md`.

### Task 8: Final verification and installed-app delivery

**Files:**
- Modify: `release/SHA256SUMS` and `docs/DELIVERY.md` with final artifact values only
- Create: `release/qa/pet-pack-smoke-test.md`

- [ ] Run `npm test`, `npm run typecheck`, `git diff --check`, package validation and a clean-clone build.
- [ ] Run `npm run dist:mac` and `npm run install:mac` from the release checkout.
- [ ] Launch only `/Applications/小满桌面伴侣.app`, verify the installed process path and import/activate a sample `.xmpet` package.
- [ ] Verify Codex export contains exactly `pet.json` and `spritesheet.webp`, and verify the app falls back after removing an invalid test package.
- [ ] Capture a current UI screenshot and record the installed version, app-asar hash and public repository URL.
- [ ] Commit `chore: verify and publish xiaoman pet pack release`.
