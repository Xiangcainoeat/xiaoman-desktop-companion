---
name: xiaoman-pet-studio
description: Turn ten pet reference photos into a validated Codex-compatible v2 .xmpet pack for Xiaoman Desktop Companion. Use when a user wants to create, replace, or package a custom desktop pet.
---

# Xiaoman Pet Studio

Create a real, import-ready pet pack from the user's reference photos. The
desktop app starts this workflow in a native Codex task; the skill owns the
authoring and QA workflow, while the app remains responsible for importing and
activating the finished pack.

## Required workflow

1. Read [photo-checklist.md](references/photo-checklist.md) and map every
   uploaded image to one of the ten required views. Keep the user's original
   files outside the repository. If a view is missing, report exactly which
   view is missing before generating it; do not silently invent an identity.
2. Read [environment-check.md](references/environment-check.md). Confirm that
   the current session has either `$imagegen` or `$relay-imagegen`, and call
   `load_workspace_dependencies` before choosing image-processing runtimes.
   If neither image capability is available, stop with a concrete setup
   report. Do not substitute CSS, SVG, screenshots, or placeholder art.
3. Use the available image skill for reference-guided raster generation. Keep
   the pet's face, coat colors, eye color, markings, proportions, and tail
   consistent across every frame. Generate only the missing views or frames
   when prior QA artifacts are already valid.
4. Use `$hatch-pet` for the Codex animation contract when it is available. The
   result must contain `spriteVersionNumber: 2`, the 9 standard animation rows,
   16 look directions, transparent edges, and deterministic frame metadata.
   If `$hatch-pet` is unavailable, install the repository's core workflow with
   the command in [environment-check.md](references/environment-check.md), then
   rerun the relevant step.
5. Run the core validators and visual QA. Reject black or colored halos,
   cropped ears/tail/paws, inconsistent coat colors, duplicated frames, and
   unverified generated images. A successful run produces a contact sheet,
   machine-readable manifest, QA report, and one `.xmpet` archive.
6. Write all deliverables to a new directory outside the app source. Never
   overwrite an existing pack until validation succeeds. Return absolute paths
   for the pack, manifest, contact sheet, and QA report, followed by the
   Xiaoman import steps.

## Hard boundaries

- Do not put API keys, relay configuration, private photo paths, or session
  logs into prompts, source files, manifests, or `.xmpet` archives.
- Do not claim that an image was generated or validated if the image tool or
  validator was unavailable.
- Keep simultaneous image-generation or image-processing jobs at 4 or fewer;
  prefer one deterministic assembly job after generation.
- Do not modify Xiaoman application source code as part of pack authoring.
- Preserve the source attribution and license metadata required by the core
  pet workflow.

For the exact ten-photo contract, read [photo-checklist.md](references/photo-checklist.md).
For capability detection and installation commands, read
[environment-check.md](references/environment-check.md).
