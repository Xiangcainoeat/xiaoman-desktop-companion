# Xiaoman 1.4.0 Care, Sleep and Games Smoke Test

## Scope

This checklist covers the new local care economy, the inactivity sleep loop, the three mini-games, and the separation between `桌宠功能`, `养成照料`, `互动游戏` and `偏好设置`. It also records the compatibility boundary: the native Codex pet profile and native task reply path remain independent.

## Automated checks

Run from the repository root:

```bash
npm run typecheck
npm test -- --run
python3 -m unittest discover -s tests -p 'test_*.py'
npm run verify:idle-atlas
npm run verify:look-96
npm run verify:care-atlas
npm run build
```

Expected results:

- all TypeScript tests pass;
- all Python atlas tests pass;
- sleep atlas is 30 frames, care atlas contains 30 bath and 30 feed/gift frames;
- game target PNGs have transparent backgrounds;
- production renderer and Electron main process compile successfully.

## Browser/UI smoke

- [ ] `养成照料` shows fullness, cleanliness, energy, affection, level and experience.
- [ ] Feeding a food with quantity 1 reduces that quantity by 1 and updates stats; a zero-quantity food remains disabled and does not update stats.
- [ ] Opening a gift box consumes one box and displays the awarded food; the fixed weights are 45% fish snack, 30% milk, 20% tuna bites and 5% salmon.
- [ ] Starting one job shows a countdown; a second job cannot start; completion grants the canonical reward and updates the daily work quest.
- [ ] The code-helper card displays its separate 12% bonus gift chance and a successful boundary roll adds exactly one gift box.
- [ ] Daily quest rewards remain disabled until the quest is complete, then can be claimed once.
- [ ] The care panel explains the fish-snack Codex reward and the idempotent completion rule.
- [ ] `互动游戏` starts each of 猜拳, 抓鱼干 and 射泡泡; canceling releases the active-game flag and grants no settlement.
- [ ] The game master switch in `桌宠功能` disables game entry and prevents settlement.
- [ ] `概览` shows a read-only care summary and opens `养成照料`; it does not directly consume food. Games only grant bounded affection and experience.
- [ ] `桌宠功能` contains gaze/motion/idle/sleep/game controls and action preview; `偏好设置` contains host/Codex/system controls without duplicate pet behavior controls.
- [ ] At narrow widths, care, game, feature and settings controls wrap without horizontal overflow or overlapping text.

## Native-window smoke

- [ ] Enabling automatic sleep and leaving the system idle beyond the configured threshold shows a complete curled-body sleeping loop.
- [ ] System activity wakes only inactivity sleep; manual sleep remains manual until explicitly woken.
- [ ] Low cleanliness produces `dirty` / `该洗澡啦` after elapsed awake time; Codex work and reminders retain priority.
- [ ] Bath and feed use the dedicated care atlas and do not use opacity blending or a separate neck layer.
- [ ] Dragging still selects the native running rows; care/game controls do not arm desktop dragging.
- [ ] Enhanced profile still selects one complete 96-direction body frame; native profile still loads the untouched native assets.
- [ ] A real Codex completion grants one fish snack; duplicate monitor events and recovered history do not grant another reward.
- [ ] Native replies continue in the owning Codex window; explicit `CLI 兼容` remains the only CLI path.

## Artifact notes

The app is unsigned and targets Apple Silicon. Attach the generated DMG, ZIP and SHA-256 file to the GitHub release rather than committing large binaries to normal source history. The native profile hash record must be unchanged after packaging.
