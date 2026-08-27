Use case: stylized-concept
Asset type: production animation direction frames for a desktop pet
Primary request: Create a 2x2 grid of four newly rendered in-between poses from the supplied 2x2 endpoint grid. The top row is one ordered transition from top-left to top-right; the bottom row is a separate ordered transition from bottom-left to bottom-right. For each row, output the left cell at one-third of the angular transition and the right cell at two-thirds. These are four independent opaque single poses, never transparent blends, double exposures, or motion blur.
Input images: Image 1 is the endpoint grid. It fixes the cat identity, camera, scale, baseline and the two difficult lower-hemisphere transitions. Image 2 is the native Codex color reference.
Scene/backdrop: perfectly flat chroma green #00FF00 in every cell.
Subject: exactly one full-body seated Siamese cat per cell, matching Xiaoman's neutral ivory/cream body, dark brown seal points and clear blue eyes.
Composition/framing: exact 2 columns by 2 rows, four equal cells, one centered cat per cell, complete ears, paws and tail visible.
Color palette: match the native reference; neutral cream and dark brown. No peach, red, pink or magenta cast.
Constraints: Top transition must continuously turn from the screen-right side gaze toward a deeply bowed straight-down gaze. Bottom transition must continuously turn from deeply bowed straight-down toward the screen-left upper-side gaze. Keep the chin/head pitch progression smooth and monotonic; the two cells in each row must visibly sit between their supplied endpoints.
Avoid: duplicate cats, ghost heads, overlapping poses, translucent subjects, sudden pose jumps, raised chin in the top row, front-facing shortcut in either row, red/pink fringe, green spill, changed anatomy, cropped body, labels, borders, text, watermark.
