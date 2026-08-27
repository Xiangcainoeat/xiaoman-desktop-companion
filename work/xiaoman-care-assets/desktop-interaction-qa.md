# Desktop Interaction QA

Date: 2026-08-28

## Runtime smoke

- Development renderer: `http://127.0.0.1:61952/`
- Packaged app: `release/mac-arm64/小满桌面伴侣.app`
- Both overlay and center pages loaded with the sandboxed preload bridge present.
- The compact care route rendered `养成照料`.
- The compact interaction route rendered `互动`.
- Clicking `更多游戏` from the interaction route selected the center tab `互动游戏`.
- The refreshed packaged build loaded the accepted 36-source-pose-derived care
  and sleep atlas resources from `app.asar`.
- The desktop bubble smoke started one session, produced four active bubbles,
  and a DOM click changed the score from 0 to 1 while leaving the pet drag path
  untouched; the session was then stopped cleanly.
- No preload load error or renderer exception appeared during the smoke run.

## Covered contracts

- A single desktop bubble session is owned by the main process.
- Bubble movement uses elapsed time, so 30 Hz and 60 Hz reach the same position over one second.
- Bubble hits are session-scoped, time-bounded and idempotent.
- Bubble pointer events stop before reaching the pet drag handler.
- Empty overlay regions remain click-through; reported bubble, pet, action and task regions are the only captured areas unless an active drag/task panel requires full capture.
- Quick care and interaction windows do not expose Codex, CLI, gaze, notification or settings controls.
- The center-tab request is buffered until the center renderer finishes loading, including a cold-start request.

## Verification commands

```text
npm run typecheck
npm test
npm run verify:care-atlas
npm run verify:idle-atlas
npm run pack:mac
```

The complete run passed with 39 Vitest files and 248 tests, 54 Python image
contract tests, and a fresh arm64 directory package. The package was launched
from its unpacked arm64 app directory and exercised through its real renderer
pages, including the bubble hit path. Screenshots are retained in
`work/xiaoman-care-assets/packaged-care-quick.png` and
`work/xiaoman-care-assets/packaged-interaction-quick.png`. A physical
multi-monitor pointer hit test remains an OS
level manual check; the click-through state machine and coordinate policy are
covered by the Electron unit tests.
