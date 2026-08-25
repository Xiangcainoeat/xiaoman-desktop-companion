# Privacy and Publication Boundary

This release is designed to be safe to publish as a source repository.

## Included

- final Xiaoman manifest and spritesheet
- derived contact sheets, direction sheet, and GIF previews
- pet-specific prompts and a sanitized request summary
- deterministic scripts and their unit tests
- sanitized QA and acceptance records
- process, retrospective, package, and runtime documentation

## Deliberately excluded

- the owner's original cat photographs
- WeChat temporary-file paths and other local source paths
- raw generated images and rejected candidates
- decoded row strips and extracted per-frame working directories
- private image-generation relay code or configuration
- API keys, cookies, access tokens, environment files, and account identifiers
- unrelated pets and workspace experiments

The public request records only `reference_count` and `references_published: false`. It preserves enough information to understand the grounding strategy without publishing the private photographs.

## Reproduction boundary

Deterministic post-processing and validation can be reproduced from equivalent row artwork. The exact generative outputs cannot be reproduced bit for bit because model sampling varies and the private generation transport is not part of the release.

Before publishing a future revision, run the path and secret scans described in `workflow/PROCESS.md` and inspect the staged Git diff. Removing a secret from the latest commit is insufficient if it already exists in Git history; rotate the credential and purge history before publishing.
