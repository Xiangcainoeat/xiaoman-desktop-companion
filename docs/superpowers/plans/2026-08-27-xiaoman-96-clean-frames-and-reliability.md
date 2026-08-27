# Xiaoman 96 Clean Frames And Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove gaze ghosting with 96 single-subject frames while adding safe missing-task CLI fallback, improving settings layout, fixing context-menu drag state, matching native color, and adding the raised-paw idle action.

**Architecture:** Keep the existing Electron/React boundaries. Extract pure selection and pointer-state helpers for testability, make native reply capability explicit at the IPC boundary, and replace blended raster assets with deterministic single-subject atlases plus QA metadata.

**Tech Stack:** Electron, React, TypeScript, Vitest, Python/Pillow/NumPy asset tooling, relay ImageGen CLI (`gpt-image-2`).

---

### Task 1: Missing Native Task CLI Fallback

**Files:**
- Modify: `electron/codex-ipc.ts`
- Modify: `electron/codex-sessions.ts`
- Modify: `electron/main.ts`
- Create: `electron/reply-log.ts`
- Test: `electron/codex-ipc.test.ts`
- Test: `electron/codex-sessions.test.ts`
- Create: `electron/reply-log.test.ts`

- [ ] Write failing tests proving native continuation remains first choice, native `task-not-found` falls back to CLI resume with the same thread ID/cwd, and authentication/timeout/unknown errors never trigger fallback; also cover message-body-free JSONL logging.
- [ ] Run the focused Vitest files and confirm each new assertion fails for the intended missing behavior.
- [ ] Implement explicit native outcome classification, the narrowly scoped `task-not-found` CLI fallback, effective `cli-fallback` transport reporting, sanitized error categories, and rotating companion-side reply logs.
- [ ] Run focused tests until green, then run all Electron reply/session tests.

### Task 2: Context Menu Drag State

**Files:**
- Modify: `src/shared/motion.ts`
- Modify: `src/components/Overlay.tsx`
- Test: `src/shared/motion.test.ts`

- [ ] Write failing tests proving secondary/control click cannot start drag and blur/context-menu/cancel resets an armed drag.
- [ ] Run the motion test and verify RED.
- [ ] Add a pure pointer eligibility/reset policy and wire Overlay events to it.
- [ ] Run the focused test and verify GREEN.

### Task 3: Settings Layout

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/styles.css`
- Test: `src/components/SettingsView.test.tsx` or an existing render test location

- [ ] Add a failing structural render test for two explicit ordered columns.
- [ ] Run the focused test and verify RED.
- [ ] Group settings sections into two independent vertical columns and add stable responsive styling.
- [ ] Run focused tests and capture desktop/narrow screenshots for visual review.

### Task 3B: Overlay Task Panel Readability

**Files:**
- Modify: `src/components/OverlayCodexPanel.tsx`
- Modify: `src/styles.css`
- Test: `src/components/OverlayCodexPanel.test.tsx` or an existing render test location

- [ ] Add failing structural assertions for stable task/status columns and accessible reply input labeling.
- [ ] Run the focused test and verify RED.
- [ ] Increase left-panel typography and line heights, shorten the textarea, expand list space, and separate left/right overlay regions without changing BrowserWindow dimensions.
- [ ] Capture a packaged overlay screenshot and verify no task row, divider, bubble, control, or pet area overlaps.

### Task 4: Single-Layer 96-Direction Runtime

**Files:**
- Modify: `src/shared/gaze.ts`
- Modify: `src/shared/gaze.test.ts`
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/shared/animation.ts`
- Modify: `src/shared/animation.test.ts`
- Modify: `public/pet/profile-manifest.json`

- [ ] Write failing tests for 96-frame quantization, frame-boundary hysteresis, wraparound, and one selected frame rather than a two-frame blend.
- [ ] Run focused tests and verify RED.
- [ ] Implement single-index gaze selection and preserve smoothed angle/idle return behavior.
- [ ] Remove the second enhanced look layer and all runtime look opacity blending.
- [ ] Run focused tests and verify GREEN.

### Task 5: 96 Clean Frames And Native Color QA

**Files:**
- Create: `scripts/build_look_atlas_96.py`
- Create: `scripts/verify_look_atlas_96.py`
- Create: `work/xiaoman-pet-96/README.md`
- Create: `work/xiaoman-pet-96/prompts/*.md`
- Create: `work/xiaoman-pet-96/imagegen-jobs.json`
- Create: `work/xiaoman-pet-96/qa/*`
- Create: `public/pet/look-96.webp`
- Create: `public/pet/look-96.json`
- Test: `scripts/tests/test_build_look_atlas_96.py`

- [ ] Write failing asset tests that reject alpha-composited double silhouettes, non-96 metadata, red/magenta spill, reference-color drift, and baseline instability.
- [ ] Run the Python asset tests and verify RED.
- [ ] Reuse the 32 clean anchors and generate two real in-between poses per anchor pair through the relay CLI with total generation/agent concurrency no greater than 6.
- [ ] Assemble normalized single-subject frames without image blending and write provenance metadata.
- [ ] Run automated QA and inspect the contact sheet, seam sheet, lower quadrant, and pixel statistics.

### Task 6: Raised Front Paw Idle Action

**Files:**
- Create: `work/xiaoman-idle-paw/prompts/*.md`
- Create: `work/xiaoman-idle-paw/qa/*`
- Modify: `public/pet/idle-actions-30.webp`
- Modify: `src/components/SettingsView.tsx`
- Modify: `src/components/Overlay.tsx`
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/shared/motion.ts`
- Modify: `src/shared/motion.test.ts`

- [ ] Write a failing motion-selection test for the raised-paw compatibility action and expected duration.
- [ ] Generate discrete key poses showing one front paw rising, holding, and returning without head scratching.
- [ ] Assemble a 30-frame no-blend sequence and replace the third idle action rows.
- [ ] Rename visible settings text to `举前爪`, retain data compatibility, and run focused tests.

### Task 7: Integration, Packaging, And Installation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `release/*`

- [ ] Run `npm run typecheck`, the full Vitest suite, asset tests, and production build.
- [ ] Run browser screenshots for settings at desktop and narrow sizes and inspect for overlap/blank grid gaps.
- [ ] Run packaged Electron smoke tests for right-click round trip, 30/60 Hz gaze, no double exposure, raised paw, and native reply success/error paths.
- [ ] Build the next arm64 DMG/ZIP/source archive, regenerate checksums, and verify every checksum.
- [ ] Preserve the currently installed app as a `/tmp` backup, cover-install the new build, launch it, and verify the bundle version, embedded 96-frame manifest, process, and window.
