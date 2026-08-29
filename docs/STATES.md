# States And Triggers

## Persisted business states

| State | Typical trigger | Duration / exit |
| --- | --- | --- |
| `idle` | No higher-priority event | Until another event |
| `working` | Codex task starts, a reply is queued, or an idle task is resumed | Until task completes |
| `waiting` | Codex requests user input | Until task continues/completes |
| `ready` | Codex task completes | 6.5 seconds |
| `failed` | Codex task error, abort, or background resume failure | 6.5 seconds |
| `hungry` | Fullness is 22 or lower | Until fed or overridden |
| `dirty` | Cleanliness is below 18 while awake | Until bathed or overridden |
| `eating` | Feed action | 6.2 seconds |
| `bathing` | Bath action | 6.2 seconds |
| `happy` | Wake action or matching app rule | Timed or until app changes |
| `affectionate` | Click or pet action | 3.2 seconds |
| `sleepy` | Energy is 18 or lower | Until sleep/energy recovery |
| `sleeping` | Sleep action | Until wake action |
| `playful` | Play action or matching app rule | 3.8 seconds or app change |
| `startled` | Matching app rule | Until app changes |
| `celebrating` | Celebrate action or matching app rule | 4.2 seconds or app change |
| `focused` | Code editor/terminal rule or long task notice | Until app/task changes |
| `reminder` | A reminder becomes due | 14 seconds |

## Renderer-only motion

| Motion | Trigger | Exit |
| --- | --- | --- |
| `running-right` | Drag delta exceeds +4px | Pointer release/cancel |
| `running-left` | Drag delta exceeds -4px | Pointer release/cancel |
| `jumping` | Pointer hover, when enabled | One animation cycle |
| `idle-lick` | Eligible random idle action | One animation cycle |
| `idle-blink` | Eligible random idle action | One animation cycle |
| `idle-scratch` | Eligible random idle action | One animation cycle |
| `care-bath` | Bath action or action preview | One 30-frame care cycle |
| `care-feed` | Feed action or action preview | One 30-frame care cycle |

Motion never overwrites pet stats or the main-process business state. Gaze is suppressed while a motion is playing.

## Stat changes

| Action | Effect |
| --- | --- |
| Fish snack | Fullness +18, energy +1, affection +1; consumes one fish snack |
| Milk | Fullness +12, energy +5, affection +2; consumes one milk |
| Tuna bites | Fullness +26, energy +2, affection +3; consumes one tuna-bites |
| Salmon | Fullness +38, energy +6, affection +4; consumes one salmon |
| Bath | Cleanliness +45, affection +2, energy -1, and one interaction |
| Pet | Affection +4 |
| Play | Affection +3, energy -7, fullness -2 |
| Sleep | Energy recovers over elapsed time |
| Awake time | Fullness, affection, energy and cleanliness decay gradually; cleanliness does not decay while sleeping |

Values are clamped to 0–100 and updated from elapsed wall-clock time, so closing the app does not pause needs indefinitely.

## Care and rewards

- A completed local job grants its canonical food and experience bundle. Only one job can run at a time; completion is settled by the main process even if the app was closed.
- The `code-helper` job additionally rolls one gift box at 12%; the chance is shown beside that job and is evaluated in the shared care domain.
- Daily quests cover one feed, bath, game, job and real Codex completion. Each completed quest can be claimed once.
- Opening one gift box consumes it and rolls one food item: fish snack 45%, milk 30%, tuna bites 20%, salmon 5%.
- A real successful Codex completion grants one fish snack and has an independent 18% chance to grant one gift box. The `threadId:turnId` ledger prevents duplicate rewards and recovered history never grants a reward.
- Games award bounded affection and experience only. They do not mint fish snacks, gift boxes or arbitrary inventory quantities.

## Proactive notifications

- Fullness at or below 20, with a two-hour cooldown
- Energy at or below 14, with a three-hour cooldown
- Active Codex work longer than 25 minutes, with a 50-minute cooldown

Codex and system notification switches live in `偏好设置`; the pet's behavior switches live in `桌宠功能`.
