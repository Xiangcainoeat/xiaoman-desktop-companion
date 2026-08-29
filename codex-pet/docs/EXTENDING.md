# Extending Xiaoman

## Changes supported by the Codex pet package

You can change any visual frame while preserving the v2 geometry and state meanings:

- redraw expressions, poses, materials, or proportions
- make action loops more readable
- replace all sixteen pointer-look directions
- adjust transparent edges and compression
- change the display name and description
- create alternate Xiaoman variants under different pet ids

After an artwork change, rebuild the full `1536x2288` spritesheet and rerun atlas, direction, continuity, and visual QA. A row-level change is safer than mixing a single regenerated cell into an otherwise coherent generated row.

## Changes the two-file package cannot make

The current Codex renderer recognizes a fixed set of state names and row positions. `pet.json` does not expose JavaScript, event handlers, custom timing, sound, menus, persistence, network access, schedules, or arbitrary new states.

Extra files placed beside `pet.json` are not a supported way to add behavior. In particular, the package alone cannot:

- invent a twelfth animation row and trigger it
- change which task event maps to `waiting`, `failed`, or `review`
- play sounds or speak
- issue operating-system notifications
- react to battery, calendar, weather, or another application
- maintain hunger, mood, affection, inventory, or long-term memory
- add click, double-click, feeding, or drag-and-drop commands

These features require code in the host application or a supported plugin/integration layer.

## Practical development paths

1. Keep Codex as the host and improve only the fixed artwork contract. This is the smallest, most stable option and needs no ongoing process.
2. Use a separate open-source desktop-pet host that can observe coding-agent events. Import or adapt Xiaoman's frames to that host's asset schema.
3. Use a host with a plugin SDK for reminders, audio, persistence, panels, commands, external events, or virtual-pet mechanics.
4. Build a dedicated desktop shell when exact event mapping, physics, multi-pet behavior, or a custom state machine matters more than Codex-native presentation.

A Codex skill can automate creation, validation, installation, or notification workflows, but a skill by itself does not alter the desktop renderer's internal trigger contract.

## Good next features

The most useful additions for Xiaoman would be:

- task-duration moods, such as focused, tired, or celebratory variants
- a clear approval-needed alert with optional sound
- click-to-pet and drag interactions
- configurable quiet hours and local reminders
- multi-agent states showing which coding task needs attention
- a small persistent affection/energy model
- an import adapter that converts this v2 atlas to another desktop-pet host

Implement these outside the two-file Codex package, then keep `pet/xiaoman` as the portable visual source.

The custom-pet renderer is not currently documented as a public OpenAI extension API. Runtime observations can change after desktop updates, so re-check behavior before relying on internal thresholds or status mappings.
