# Third-Party Notices

## Hatch Pet tooling

`SKILL.md`, `scripts/`, `tests/`, and `references/` are copied or adapted from the locally installed `hatch-pet` Codex skill. That skill is distributed under the Apache License 2.0. The full license text is included in `LICENSE`.

This repository adds Xiaoman-specific prompts, documentation, packaging, and QA artifacts and identifies the copied workflow files in the repository structure.

## Pillow

The Python image tooling depends on Pillow. Pillow is installed separately through `requirements.txt`; this repository does not vendor its source or binaries. Refer to the Pillow project for its current license terms.

## Image generation

Xiaoman's visual source material was produced with `gpt-image-2` through a private OpenAI-compatible relay. The relay implementation, credentials, request logs, and raw candidates are not included. No model weights are distributed by this repository.
