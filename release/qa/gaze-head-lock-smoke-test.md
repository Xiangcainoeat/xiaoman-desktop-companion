# Head-Lock Gaze Smoke Test

Date: 2026-08-27
Version: 1.3.0

## Contract covered

- Enhanced profile keeps the body/action sprite on the exact frame visible when
  gaze starts.
- A single spatial face-mask layer selects one of 96 directions; it does not
  opacity-blend adjacent frames.
- Upper and lower cursor targets change the head layer while leaving torso,
  tail and paw pixels unchanged.
- Pointer velocity shortens the gaze response time constant for fast motion.
- After the configured inactivity timeout, the head layer is hidden and the
  ordinary forward idle face returns.
- Native profile remains independently selectable and continues to use its
  accepted 16-direction full-body atlas.

## Automated result

`npm run typecheck`, `npm test`, the Python test suite, and the head atlas
verifier pass. The verifier reports 96 distinct non-empty frames, zero hidden
RGB pixels, zero pixels outside the face mask and `temporalBlend: false`.

## Runtime result

In an isolated development Electron window, upper-right and lower-left gaze
captures were taken without waiting for an action-cycle boundary. In the
98,700-pixel torso/tail/paw comparison region, only `2` pixels differed and
the maximum channel delta was `2`, which is capture/compositor noise; the
body did not visibly move and the intentional changes were confined to the
head region. After pointer inactivity the DOM computed visibility for
`.pet-head-look-layer` was `hidden`, and a fresh capture showed the forward idle
face. The task view simultaneously displayed native Codex generated names such
as `hatch-pet-users-zk-codex-skills` rather than the first prompt.

The smoke test moves only the system pointer and reads rendered state. It does
not send a message to a real Codex task.
