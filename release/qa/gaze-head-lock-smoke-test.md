# Full-Body Gaze Smoke Test

Date: 2026-08-27
Version: 1.3.1

## Contract covered

- Enhanced profile selects a complete coherent body frame from the 96-direction
  gaze atlas, keeping the head, neck, torso, paws and tail connected.
- One full-body direction is selected at a time; adjacent frames are not
  opacity-blended.
- Upper and lower cursor targets change the complete body pose rather than
  splicing a separate face or neck layer.
- Pointer velocity shortens the gaze response time constant for fast motion.
- After the configured inactivity timeout, the ordinary forward body frame and
  state animation return.
- Native profile remains independently selectable and continues to use its
  accepted 16-direction full-body atlas.

## Automated result

`npm run typecheck`, `npm test`, the Python test suite, and the full-body look
atlas verifier pass. The verifier reports 96 distinct non-empty frames, zero
hidden RGB pixels, no double-exposure alpha and `temporalBlend: false`.

## Runtime result

In an isolated development Electron window, upper-right and lower-left gaze
captures were taken with the enhanced profile. The rendered layer switched
from the base sprite to the corresponding complete `look-96.webp` cells; no
separate head layer or neck splice was present. After pointer inactivity a
fresh capture showed the forward idle body. The task view simultaneously
displayed native Codex generated names such as `hatch-pet-users-zk-codex-skills`
rather than the first prompt.

The smoke test moves only the system pointer and reads rendered state. It does
not send a message to a real Codex task.
