# Public Release Boundary

This directory is the public source release of **Xiaoman Desktop Companion**, a
macOS desktop pet that can stay beside the user's work, react to Codex tasks,
run local H5 games, and load replaceable pet asset packs.

## Included

- Electron/React desktop-pet source, local persistence, Codex task transport,
  care and interaction features, reminders, sound controls, and game hosting.
- Nine local H5 game entries plus an explicit online Lichess handoff. The
  catalog and each upstream commit are recorded in `docs/GAMES.md` and
  `vendor/article-games/`.
- The complete Xiaoman runtime profile and Codex v2 two-file profile.
- The machine-readable asset replacement contract at
  `public/pet/asset-manifest.json` and its human-readable companion.
- A reusable prompt catalog and authoring CLI for one or many reference images:
  `pet:init`, `pet:prompts`, `pet:generate`, `pet:pack`, `pet:validate`, and
  `pet:install`.
- Deterministic atlas assembly, alpha/chroma cleanup, validation scripts,
  previews, tests, and sanitized QA summaries.

## Deliberately excluded

- Original reference photographs, discarded generations, private relay data,
  API keys, Codex session content, local user paths, and generated `.xmpet`
  archives.
- `node_modules`, build output, release installers, and authoring workspaces.
- The supplied sliding-puzzle snapshot, because its source did not include a
  redistributable license. It is not silently relicensed or presented as
  application code.

The published Xiaoman images are user-directed project assets, not a blanket
license for third parties to reuse the character. See `ASSETS_LICENSE.md` and
`THIRD_PARTY_NOTICES.md` before making a fork or distributing a build.

## Reproduce the release checks

```bash
npm ci
npm run typecheck
npm test
npm run scan:public
npm run build
```

The GitHub Actions workflow runs the same checks on macOS. `npm run dev` starts
the desktop host; `npm run dev:web` starts the browser-only renderer preview.

## Replace the pet

1. Keep source photos outside the repository and run `npm run pet:init` with
   one or more `--refs` paths.
2. Run `npm run pet:prompts` to create the action-specific prompt files.
3. Review the dry-run with `npm run pet:generate`. Add `--execute` only after
   configuring `PET_IMAGE_API_KEY` and the optional endpoint/model variables.
4. Assemble and clean the generated frames with the deterministic scripts,
   place the resulting files under the paths in `public/pet/asset-manifest.json`,
   then run `npm run pet:pack` and `npm run pet:validate`.
5. Import the resulting `.xmpet` through the desktop app or run
   `npm run pet:install -- --package <file.xmpet> --activate`.

The image generator defaults to dry-run and caps all workers at six concurrent
requests. Packaging strips reference images, environment files, raw job files,
and other authoring-only data; import validates paths and SHA-256 checksums
before atomically activating the replacement profile.
