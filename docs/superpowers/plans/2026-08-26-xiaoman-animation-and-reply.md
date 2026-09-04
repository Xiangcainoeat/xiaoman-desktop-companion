# Xiaoman Animation and Reply Reliability Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Give the Xiaoman desktop companion a stable 30 Hz default with a 60 Hz option, generate and clean real additional idle-action frames, and make Codex task replies reliable without opening the Codex frontend.

Architecture: Keep the native Codex pet package untouched and change only the host application. A deterministic atlas builder will turn three generated 10x3 action sheets into one 10x9 transparent atlas with per-frame QA metadata; the renderer will use a requestAnimationFrame accumulator and explicit atlas dimensions. The Codex service will reconcile local lifecycle logs with app-server metadata, omit invalid working directories, and preserve a bounded queue/resume fallback with truthful startup/error states.

Tech Stack: Electron, React, TypeScript, Vite, Vitest, Python Pillow from the bundled workspace runtime, relay ImageGen, macOS hdiutil/ditto packaging.

---

### Task 1: Establish the asset-generation inputs and deterministic QA builder

Files:
- Create: work/idle-actions-30-guide.png
- Create: work/idle-actions-30-generated-lick.png
- Create: work/idle-actions-30-generated-blink.png
- Create: work/idle-actions-30-generated-scratch.png
- Create: scripts/build_idle_atlas_30.py
- Create: scripts/verify_idle_atlas_30.py
- Create: scripts/idle-atlas-contract.ts
- Create: tests/idle-atlas.test.ts
- Modify: package.json

- [ ] Step 1: Add the failing atlas contract test

Create a Vitest test that reads a small fixture report produced by the builder and asserts the public contract: 10 columns, 9 rows, 30 frames per action, non-empty frames, zero hidden RGB in transparent pixels, and a bounded edge contamination count. The test must also reject a report with a missing action row or an empty frame.

~~~
import { describe, expect, it } from "vitest";
import { validateIdleAtlasReport } from "../scripts/idle-atlas-contract";

describe("30-frame idle atlas contract", () => {
  it("accepts a complete clean 10x9 report", () => {
    expect(validateIdleAtlasReport({
      columns: 10,
      rows: 9,
      actions: {
        "idle-lick": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
        "idle-blink": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 1 },
        "idle-scratch": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
      },
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects empty frames and a missing action", () => {
    const result = validateIdleAtlasReport({
      columns: 10,
      rows: 6,
      actions: {
        "idle-lick": { frames: 30, emptyFrames: 1, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "atlas must have 9 rows",
      "idle-lick contains empty frames",
      "idle-blink report is missing",
      "idle-scratch report is missing",
    ]));
  });
});
~~~

- [ ] Step 2: Run the focused test and verify it fails

Run: npm test -- --run tests/idle-atlas.test.ts

Expected: FAIL because scripts/idle-atlas-contract.ts does not exist yet.

- [ ] Step 3: Implement the report contract and builder

Add scripts/idle-atlas-contract.ts with the exact validateIdleAtlasReport(report: unknown): { ok: boolean; errors: string[] } export used above. Add scripts/build_idle_atlas_30.py using Pillow and these fixed rules:

~~~
CELL_WIDTH = 192
CELL_HEIGHT = 208
COLUMNS = 10
ROWS_PER_ACTION = 3
ACTION_ORDER = ("idle-lick", "idle-blink", "idle-scratch")
EDGE_CONTAMINATION_LIMIT = 4
~~~

The script must accept three 10x3 source sheets, extract exactly 30 cells per sheet, resize each cell to 192x208 with Image.Resampling.LANCZOS, remove the source green chroma key, clear RGB values wherever alpha is zero, and run an edge-only despill pass. The despill pass may alter a pixel only when it is in the outer two-pixel alpha boundary and its hue is closer to the configured green/magenta contamination colors than to the nearest opaque interior sample; it must never blanket-replace opaque interior pixels. Assemble output rows 0..2 for lick, 3..5 for blink, and 6..8 for scratch into public/pet/idle-actions-30.webp, write a contact sheet to work/idle-actions-30-contact-sheet.png, and write work/idle-actions-30-report.json with dimensions, algorithm id, per-frame visible-pixel counts, hidden-RGB counts, and edge-contamination counts. Exit non-zero if any frame is empty or a count exceeds its limit.

Add scripts/verify_idle_atlas_30.py to composite every frame over white, charcoal, and checkerboard backgrounds and fail when a frame has a visible pink/green halo above the same edge threshold. Add this npm script:

~~~
"verify:idle-atlas": "python3 scripts/verify_idle_atlas_30.py"
~~~

Use the bundled Python runtime from codex_app__load_workspace_dependencies, not a system Python. Keep scripts/idle-atlas-contract.ts free of filesystem side effects so Vitest can import it.

- [ ] Step 4: Generate the actual additional action frames through the relay

Read `$CODEX_HOME/skills/.system/imagegen/SKILL.md` and `$CODEX_HOME/skills/relay-imagegen/SKILL.md` immediately before generation. Use the relay wrapper at the skills/relay-imagegen/scripts/relay_imagegen.sh under CODEX_HOME or HOME. Generate one sheet per action using the native Xiaoman face/body as identity reference and work/idle-actions-30-guide.png as a layout guide. Each prompt must require 30 distinct sequential frames in a 10-column by 3-row grid, no labels, no borders, no shadows, no background, consistent camera, consistent body proportions, neutral first/last frame, and natural intermediate motion. Generate lick, blink, and scratch as separate outputs so a failed action can be regenerated without replacing the others.

- [ ] Step 5: Inspect and build the generated sheets

View all three generated PNGs and the contact sheet with view_image. Reject and regenerate only a sheet with a concrete defect such as missing cells, identity drift, clipped ears/tail, frozen duplicate frames, or visible colored matte. Run:

~~~
PYTHON=$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
$PYTHON scripts/build_idle_atlas_30.py \
  --lick work/idle-actions-30-generated-lick.png \
  --blink work/idle-actions-30-generated-blink.png \
  --scratch work/idle-actions-30-generated-scratch.png
$PYTHON scripts/verify_idle_atlas_30.py
npm test -- --run tests/idle-atlas.test.ts
~~~

Expected: the builder exits 0, creates public/pet/idle-actions-30.webp, the report validates, and the focused test passes. Inspect the contact sheet over light and dark backgrounds before continuing.

- [ ] Step 6: Commit the asset pipeline and generated source sheets

~~~
git add scripts/idle-atlas-contract.ts scripts/build_idle_atlas_30.py scripts/verify_idle_atlas_30.py tests/idle-atlas.test.ts package.json work/idle-actions-30-guide.png work/idle-actions-30-generated-*.png work/idle-actions-30-contact-sheet.png work/idle-actions-30-report.json public/pet/idle-actions-30.webp
git commit -m "feat: add clean 30-frame Xiaoman idle atlas"
~~~

### Task 2: Add a tested 30/60 Hz animation clock and atlas-aware sprite specs

Files:
- Create: src/shared/animation.ts
- Create: tests/animation.test.ts
- Modify: src/shared/types.ts
- Modify: src/shared/domain.ts
- Modify: src/components/PetSprite.tsx
- Modify: src/components/SettingsView.tsx
- Modify: src/components/Overlay.tsx
- Modify: tests/domain.test.ts

- [ ] Step 1: Write failing clock and atlas-coordinate tests

Add pure tests for a frame accumulator and coordinate helper. The expected behavior is that a 30 Hz clock advances exactly 30 logical ticks per second, a 60 Hz clock does not duplicate a logical frame update when the animation FPS is lower, elapsed time is capped after a suspended tab, and an idle action uses 10 columns with no coordinate outside its 30-frame row block.

~~~
import { describe, expect, it } from "vitest";
import { advanceAnimationClock, atlasFramePosition } from "../src/shared/animation";

describe("animation clock", () => {
  it("advances one 30 fps animation through 30 frames in one second", () => {
    let clock = { frame: 0, remainderMs: 0 };
    for (let tick = 0; tick < 30; tick += 1) {
      clock = advanceAnimationClock(clock, 1000 / 30, 30, 30);
    }
    expect(clock.frame).toBe(0);
    expect(clock.remainderMs).toBeLessThan(1);
  });

  it("does not select an idle frame outside its 10x3 block", () => {
    expect(atlasFramePosition({ row: 6, frames: 30, columns: 10 }, 29)).toEqual({ column: 9, row: 8 });
  });
});
~~~

- [ ] Step 2: Run the focused test and verify it fails

Run: npm test -- --run tests/animation.test.ts

Expected: FAIL because src/shared/animation.ts does not exist.

- [ ] Step 3: Implement the minimal pure clock

Define:

~~~
export interface AnimationClock { frame: number; remainderMs: number }
export interface AtlasFrameSpec { row: number; frames: number; columns: number }
export function advanceAnimationClock(clock: AnimationClock, elapsedMs: number, fps: number, frameCount: number): AnimationClock
export function atlasFramePosition(spec: AtlasFrameSpec, frame: number): { column: number; row: number }
~~~

Clamp elapsed time to 0..250, add elapsedMs * fps / 1000 through a remainder accumulator, advance by the integer portion, wrap by frameCount, and preserve the fractional remainder. Validate fps, frameCount, and columns with finite positive values. atlasFramePosition must use Math.floor(frame / columns) and reject a frame outside 0..frames-1.

- [ ] Step 4: Add the persisted animation rate setting and migration test

Add animationFrameRate: 30 | 60 to CompanionSettings, default it to 30, normalize only 30 or 60, and preserve old data by falling back to 30. Extend tests/domain.test.ts with an invalid-value migration assertion. Keep gazeFrameRate unchanged for cursor polling so existing gaze behavior remains independently configurable.

- [ ] Step 5: Replace interval playback with RAF and explicit atlas dimensions

In src/components/PetSprite.tsx, add columns and atlasRows to AnimationSpec; use columns: 10, frames: 30, and row bases 0, 3, 6 for the new idle atlas. Keep standard rows at eight columns and their existing populated-frame counts. Replace the animation setInterval effect with a requestAnimationFrame loop using advanceAnimationClock, resetting the clock only when motion or state changes. Schedule React state updates only when the logical frame changes. Set the CSS backgroundSize from animation.columns, not a hardcoded eight. Use url('./pet/idle-actions-30.webp') for host idle actions. Preserve reduced-motion behavior and the existing settled-state transition.

In src/components/Overlay.tsx, derive action durations from an IDLE_ACTION_LOOPS map and the actual frame count/FPS (30 / fps * loops) so a 30-frame action is not cut off at the old 8-frame duration. Keep the existing drag-run and hover-jump motion selection, but let the new playback clock render those standard rows too.

- [ ] Step 6: Expose 30/60 Hz in settings and verify behavior

Add a “动作刷新率” segmented control with buttons 30 and 60, defaulting to 30, and disable it only when the overlay is hidden. Do not relabel the existing gaze control. Run:

~~~
npm test -- --run tests/animation.test.ts tests/domain.test.ts
npm run typecheck
~~~

Expected: focused tests and all TypeScript projects pass. Commit:

~~~
git add src/shared/animation.ts tests/animation.test.ts src/shared/types.ts src/shared/domain.ts src/components/PetSprite.tsx src/components/SettingsView.tsx src/components/Overlay.tsx tests/domain.test.ts
git commit -m "feat: drive Xiaoman animations with a 30 or 60 Hz clock"
~~~

### Task 3: Make Codex reply routing resilient to stale metadata and invalid cwd

Files:
- Modify: electron/codex-sessions.ts
- Modify: electron/main.ts
- Modify: electron/codex-sessions.test.ts
- Modify: tests/codex-monitor.test.ts
- Modify: tests/codex-ui.test.ts

- [ ] Step 1: Add failing regression tests

Add the following exact regression tests. Use the existing recordingSpawner and localRecord helpers. The required service-test body is:

~~~
it("marks a locally running task replyable even when app-server says false", async () => {
  const service = new CodexSessionsService({
    appServerRequest: async () => ({ data: [{ id: THREAD_ID, status: { type: "notLoaded" }, canAcceptDirectInput: false }] }),
    localSessionScanner: async () => [localRecord({ activity: "running" })],
  });
  await expect((await service.listSessions()).sessions[0].canAcceptDirectInput).toBe(true);
});

it("omits a stale cwd when resuming", async () => {
  const recorder = recordingSpawner();
  const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });
  await service.sendReply({ threadId: THREAD_ID, message: "继续", activity: "idle", cwd: "/definitely/missing/xiaoman-cwd" });
  expect(recorder.invocations[0].cwd).toBeUndefined();
});

it("recovers a queue race by resuming only after a fresh idle read", async () => {
  const recorder = recordingSpawner([processResult(1, "No active session found matching thread")]);
  const service = new CodexSessionsService({
    codexPath: "/safe/codex",
    processSpawner: recorder.spawner,
    localSessionScanner: async () => [localRecord({ activity: "idle" })],
    appServerRequest: async () => { throw new Error("offline"); },
  });
  const dispatch = await service.sendReply({ threadId: THREAD_ID, message: "继续", activity: "running" });
  expect(dispatch.transport).toBe("exec-resume");
  expect(recorder.invocations.map((invocation) => invocation.args[0])).toEqual(["queue", "exec"]);
});

it("keeps the reply input and exposes a bounded command error", async () => {
  const message = "继续执行并保留输入";
  const recorder = recordingSpawner([processResult(1, "daemon unavailable")]);
  const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });
  await expect(service.sendReply({ threadId: THREAD_ID, message, activity: "running" })).rejects.toThrow("daemon unavailable");
  expect(message).toBe("继续执行并保留输入");
});
~~~

Add UI assertions that an active log-derived task has an enabled reply control and that a failed dispatch displays the returned error rather than “已启动”.

- [ ] Step 2: Run the focused tests and verify the failures

Run: npm test -- --run electron/codex-sessions.test.ts tests/codex-monitor.test.ts tests/codex-ui.test.ts

Expected: the new stale-metadata, stale-cwd, and queue-race assertions fail against the current implementation.

- [ ] Step 3: Reconcile local lifecycle status and direct-input capability

In electron/codex-sessions.ts, when local.activity is running or waiting, set canAcceptDirectInput to true unless the local record explicitly represents an approval wait. The local lifecycle status must win over notLoaded/unknown runtime metadata; an app-server canAcceptDirectInput false must not make a clearly running log-derived task look non-replyable. In electron/main.ts, centralize the same policy in a pure helper or a single expression so list and send validation cannot disagree. Keep approval waits blocked.

- [ ] Step 4: Ignore unusable resume directories

Add an isUsableWorkingDirectory helper using stat/statSync semantics and pass cwd only when it is absolute, exists, and is a directory. Do not create directories or fall back to a user-supplied file path. exec resume --skip-git-repo-check remains the resume command and still receives the prompt through stdin.

- [ ] Step 5: Add one bounded queue-to-resume race recovery

For mode: "auto" with a running/waiting activity, call queueReply once. If it throws CodexSessionCommandError whose bounded output matches the active-session-not-found condition, call readSession(threadId) once. If the fresh result is idle or error, call startResume once with its cwd; otherwise rethrow the original queue error. Never retry more than once and never resume a task that is still running/waiting. Preserve fallbackReason as a short diagnostic string.

- [ ] Step 6: Keep truthful UI state and error text

Ensure replyToCodexThread checks the reconciled activity and approval state, leaves the input untouched on rejection, and records success only after sendReply returns. Map CodexSessionCommandError to its bounded result.stderr/result.stdout summary. Refresh the task list after a successful queue or resume dispatch; on failure show the error returned by the service. Do not claim that the reply started before resume receives turn.started.

- [ ] Step 7: Run the focused suite and commit

~~~
npm test -- --run electron/codex-sessions.test.ts tests/codex-monitor.test.ts tests/codex-ui.test.ts
git diff --check
git add electron/codex-sessions.ts electron/main.ts electron/codex-sessions.test.ts tests/codex-monitor.test.ts tests/codex-ui.test.ts
git commit -m "fix: make Codex companion replies resilient"
~~~

Expected: all focused tests pass and the diff contains no whitespace errors.

### Task 4: Integrate source/release copies and run full automated verification

Files:
- Mirror to source: package.json; scripts/idle-atlas-contract.ts; scripts/build_idle_atlas_30.py; scripts/verify_idle_atlas_30.py; src/shared/animation.ts; src/shared/types.ts; src/shared/domain.ts; src/components/PetSprite.tsx; src/components/SettingsView.tsx; src/components/Overlay.tsx; electron/codex-sessions.ts; electron/main.ts; public/pet/idle-actions-30.webp
- Modify in release repository: package.json; scripts/idle-atlas-contract.ts; scripts/build_idle_atlas_30.py; scripts/verify_idle_atlas_30.py; src/shared/animation.ts; src/shared/types.ts; src/shared/domain.ts; src/components/PetSprite.tsx; src/components/SettingsView.tsx; src/components/Overlay.tsx; electron/codex-sessions.ts; electron/main.ts; tests/idle-atlas.test.ts; tests/animation.test.ts; tests/domain.test.ts; electron/codex-sessions.test.ts; tests/codex-monitor.test.ts; tests/codex-ui.test.ts; public/pet/idle-actions-30.webp; work/idle-actions-30-guide.png; work/idle-actions-30-generated-lick.png; work/idle-actions-30-generated-blink.png; work/idle-actions-30-generated-scratch.png; work/idle-actions-30-contact-sheet.png; work/idle-actions-30-report.json
- Create: release/qa/animation-report.json
- Create: release/qa/reply-smoke-test.md

- [ ] Step 1: Mirror only the reviewed implementation and host assets

Copy the changed application files and generated host assets from the release repository into the source application directory. Do not copy .git, docs/superpowers, release/, dist/, or any file into ~/.codex/pets/xiaoman. Verify native hashes remain exactly:

~~~
shasum -a 256 ~/.codex/pets/xiaoman/pet.json ~/.codex/pets/xiaoman/spritesheet.webp
~~~

- [ ] Step 2: Run the complete test and build gates

From the release repository run:

~~~
npm test
npm run typecheck
npm run build
npm run verify:idle-atlas
~~~

Expected: every Vitest test passes, all TypeScript projects typecheck, Vite/Electron build succeeds, and the atlas verifier exits 0. Save the report summary and native hashes in release/qa/animation-report.json.

- [ ] Step 3: Package the macOS app and inspect the packaged asset

Run npm run dist:mac, then inspect the generated .app with find/unzip to confirm it contains resources/app.asar with public/pet/idle-actions-30.webp and does not contain a modified native pet package. Run the existing packaging QA scripts and record paths and SHA-256 values in release/qa/animation-report.json.

- [ ] Step 4: Perform visual and interaction smoke tests

Launch the packaged app in an isolated user-data directory. Capture 30 Hz and 60 Hz screenshots after at least three seconds of lick, blink, scratch, drag-run, and hover-jump activity. Composite the atlas over white, charcoal, and checkerboard backgrounds and inspect for red/pink or green edges. Create release/qa/reply-smoke-test.md with the temporary thread id, commands used, whether active queue and idle resume each received their acknowledgement, and any bounded errors. Do not include the user’s Codex password or private message content in the artifact.

- [ ] Step 5: Commit integration and QA evidence

~~~
git add public/pet/idle-actions-30.webp work/idle-actions-30-* release/qa
git commit -m "chore: publish Xiaoman animation and reply QA"
~~~

### Task 5: Final review, release synchronization, and handoff

Files:
- Modify: README.md
- Modify: CHANGELOG.md
- Modify: release/SHA256SUMS.txt
- Modify: release/manifest.json

- [ ] Step 1: Review the complete diff against the design

Check that the diff contains real generated source sheets and a deterministic 30-frame atlas, no native Codex package changes, explicit 30/60 settings, RAF playback, edge cleanup evidence, and queue/resume tests. Search for setInterval in src/components/PetSprite.tsx and for hardcoded * 8 atlas sizing in the new idle path; neither may remain.

- [ ] Step 2: Update release documentation and checksums

Document the new asset, default 30 Hz behavior, optional 60 Hz behavior, color-cleanup report, and reply fallback semantics. Regenerate checksums for the final .app, .zip, source archive, atlas, contact sheet, and QA reports. Keep generated build directories ignored and keep the native package hash record unchanged.

- [ ] Step 3: Run the final verification command set

~~~
git diff --check
git status --short
npm test
npm run typecheck
npm run build
npm run verify:idle-atlas
git log --oneline -6
~~~

Expected: all commands exit 0; git status contains only intentionally ignored build output or is clean; the final commit history contains the design, asset, animation, reply, and QA commits.

- [ ] Step 4: Close the visual companion and temporary processes

Stop the brainstorming server and terminate only the temporary debug app/QA processes started for this task. Leave the installed companion app available at /Applications/小满桌面伴侣.app and report the exact release paths, test results, and any residual limitation.
