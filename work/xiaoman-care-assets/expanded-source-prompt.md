# Xiaoman Expanded Care Source Prompt

Create a 6 by 6 contact sheet containing 36 sequential, independently rendered
poses of Xiaoman. Keep one complete cat in every cell with the same camera
distance, body scale, ground line and warm cream/brown Siamese fur palette as
the supplied native Codex reference. Use a flat vivid green chroma matte
(`#12ee1c`) with no shadows or gradients.

For the sleeping sheet, show a complete curled sleeping cat with small,
readable breathing, paw and tail changes across the sequence. For the bath
sheet, show a coherent bath cycle: approach the basin, dip or lift a paw,
small splashes, face rub, towel/dry moment and return. For the feed/gift sheet,
show eating fish snacks followed by a clear gift-box reveal and a small yarn
reward. Keep every pose fully inside its cell and preserve the complete ears,
face, torso, paws, tail and any action prop.

Do not add text, labels, borders, cell lines, UI, watermark, scenery, detached
body parts, neck seams, duplicate characters, motion streaks, black matte,
colored halo or a second cat. The sheet is source material for deterministic
chroma extraction: each cell must contain one independently generated pose,
not a collage or a temporal blend.

The local deterministic builder extracts the 36 cells, samples 30 registered
runtime slots, keeps a shared baseline, caps undersized-pose correction at
1.2x, and never blends pixels between poses. See
`expanded-source-provenance.json` for the accepted source hashes and output
mapping.
