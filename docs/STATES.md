# States And Triggers

| State | Typical trigger | Duration / exit |
| --- | --- | --- |
| `idle` | No higher-priority event | Until another event |
| `working` | Codex `task_started` or recovered active task | Until task completes |
| `waiting` | Codex requests user input | Until task continues/completes |
| `ready` | Codex task completes | 6.5 seconds |
| `failed` | Codex task error or abort | 6.5 seconds |
| `hungry` | Fullness is 22 or lower | Until fed or overridden |
| `eating` | Feed action | 4.2 seconds |
| `happy` | Wake action or matching app rule | Timed or until app changes |
| `affectionate` | Click or pet action | 3.2 seconds |
| `sleepy` | Energy is 18 or lower | Until sleep/energy recovery |
| `sleeping` | Sleep action | Until wake action |
| `playful` | Play action or matching app rule | 3.8 seconds or app change |
| `startled` | Matching app rule | Until app changes |
| `celebrating` | Celebrate action or matching app rule | 4.2 seconds or app change |
| `focused` | Code editor/terminal rule or long task notice | Until app/task changes |
| `reminder` | A reminder becomes due | 14 seconds |

## Stat changes

| Action | Effect |
| --- | --- |
| Feed | Fullness +28, energy +3, affection +2 |
| Pet | Affection +4 |
| Play | Affection +3, energy -7, fullness -2 |
| Sleep | Energy recovers over elapsed time |
| Awake time | Fullness and energy decay gradually |

Values are clamped to 0–100 and updated from elapsed wall-clock time, so closing the app does not pause needs indefinitely.

## Proactive notifications

- Fullness at or below 20, with a two-hour cooldown
- Energy at or below 14, with a three-hour cooldown
- Active Codex work longer than 25 minutes, with a 50-minute cooldown

Each category can be disabled globally from Settings.
