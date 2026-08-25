# Xiaoman Desktop Companion v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add smooth configurable gaze, native-style motion, idle behavior, feature controls, and supported Codex task controls without changing the native two-file pet.

**Architecture:** Keep persistent domain data, renderer motion, and Codex session transport separate. Use canonical v2 look cells with runtime interpolation, transient motion overrides for drag/hover/idle, and supported Codex app-server or CLI methods for task operations.

**Tech Stack:** Electron 44, React 19, TypeScript 6, Vite 8, Vitest 4, Python/Pillow atlas assembly, Codex app-server/CLI.

---

### Task 1: Data migration and pure gaze math

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/domain.ts`
- Create: `src/shared/gaze.ts`
- Modify: `tests/domain.test.ts`
- Create: `tests/gaze.test.ts`

- [ ] Write tests for version-1 migration, phrase sanitization, upper-half clamping, circular smoothing, inactivity return, and direction interpolation.
- [ ] Run `npm test -- tests/domain.test.ts tests/gaze.test.ts` and confirm the new gaze tests fail before implementation.
- [ ] Implement the minimal pure functions and schema defaults.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Canonical look and idle atlases

**Files:**
- Create: `scripts/build_native_look_atlas.py`
- Create: `scripts/build_idle_atlas.py`
- Create: `public/pet/look-16.webp`
- Create: `public/pet/idle-actions.webp`
- Create: `work/idle-actions-prompt.md`
- Create: `work/idle-actions-validation.json`

- [ ] Extract rows 9-10 of the accepted native atlas without changing source pixels.
- [ ] Generate the 3x8 idle source sheet through the configured relay ImageGen path.
- [ ] Assemble transparent host atlases deterministically and reject blank, clipped, or green-contaminated cells.
- [ ] Inspect both labeled contact sheets visually.

### Task 3: Renderer motion and gaze

**Files:**
- Modify: `src/components/PetSprite.tsx`
- Modify: `src/components/Overlay.tsx`
- Modify: `src/styles.css`
- Create: `tests/motion.test.ts`

- [ ] Write failing tests for the 4 px drag threshold, drag direction, upper/full gaze mapping, and idle action selection.
- [ ] Implement nearest-frame canonical gaze with one full-body layer and state updates only when the selected direction changes.
- [ ] Implement drag run, one-shot hover jump, idle scheduler, random speech, and mouse inactivity reset.
- [ ] Verify no action changes layout dimensions.

### Task 4: Settings and feature management

**Files:**
- Modify: `src/components/SettingsView.tsx`
- Create: `src/components/FeaturesView.tsx`
- Modify: `src/components/ControlCenter.tsx`
- Modify: `src/bridge.ts`
- Modify: `electron/preload.ts`
- Modify: `src/electron.d.ts`
- Modify: `electron/main.ts`

- [ ] Add real controls for gaze mode, frame rate, inactivity, size, native motion, idle actions, speech, sounds, notifications, app events, and Codex tasks.
- [ ] Add phrase entry, deletion, and reset commands with main-process sanitization.
- [ ] Resize the overlay around its lower-right anchor when pet size changes.
- [ ] Check all controls at 900x640 and 1080x730.

### Task 5: Codex task controls

**Files:**
- Create: `electron/codex-sessions.ts`
- Create: `electron/codex-sessions.test.ts`
- Create: `src/components/CodexTasksView.tsx`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/electron.d.ts`
- Modify: `src/bridge.ts`
- Modify: `src/components/ControlCenter.tsx`

- [ ] Test command construction, JSON parsing, status mapping, reply validation, and unavailable capability handling.
- [ ] List recent tasks with safe metadata only.
- [ ] Queue active replies and resume inactive tasks through supported operations.
- [ ] Open the exact task only through a verified route; otherwise open ChatGPT and return an explicit fallback result.

### Task 6: Verification, review, and release

**Files:**
- Modify: `package.json`
- Modify: `work/README.md`
- Create: `work/qa-v1.1/**`
- Update: `../outputs/xiaoman-desktop-companion-release/**`

- [ ] Run focused tests, then `npm test`, `npm run typecheck`, `npm run build`, and `npm audit --omit=dev`.
- [ ] Run an independent spec-compliance review and then an independent code-quality review; resolve findings.
- [ ] Exercise 30/60 Hz, upper/full gaze, down sweep, inactivity reset, drag both directions, hover, all idle actions, phrases, sizes, task list, and reply error handling.
- [ ] Package arm64 app, DMG, ZIP, source, docs, prompts, scripts, reports, screenshots, checksums, and the unchanged Codex pet.
- [ ] Compare native pet SHA-256 hashes with the installed pair and update the clean release repository and tag.
