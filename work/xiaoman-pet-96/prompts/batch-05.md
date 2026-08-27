Use case: stylized-concept
Asset type: production animation direction frames for a desktop pet
Primary request: Transform the supplied 4x2 endpoint reference grid into a 4x2 grid of true in-between poses. Treat cells as four adjacent horizontal pairs in row-major order. In every pair, output cell one is exactly one-third of the head, eyes, ears and neck rotation from the supplied left endpoint toward the supplied right endpoint; output cell two is exactly two-thirds. These must be newly rendered single poses, never alpha blends or double exposures.
Input images: Image 1 is the endpoint grid and fixes pose progression, character, camera and cell layout. Image 2 is the native Codex color reference and fixes cream body fur, dark seal-point face/ears/paws/tail and clear blue eyes.
Scene/backdrop: perfectly flat chroma green #00FF00 in every cell.
Subject: exactly one full-body seated Siamese cat per cell, matching Xiaoman's proportions and 3D-rendered style.
Composition/framing: exact 4 columns by 2 rows, eight equal cells, one centered cat per cell, same scale and paw baseline as Image 1, complete ears/paws/tail visible.
Color palette: match Image 2; neutral ivory/cream body with dark brown seal points; no peach, red, pink or magenta cast.
Constraints: preserve clockwise continuity; only pose direction changes; sharp single silhouette; clean fur edge against green; no shadows, labels, borders or text.
Avoid: duplicate cats, ghost heads, overlapping poses, translucent subjects, motion blur, red/pink fringe, green spill, changed anatomy, changed expression, changed camera, cropped body, watermark.

Critical lower-zone constraint: output cells 0 through 5 must stay deeply bowed and looking below the pet, with only tiny horizontal yaw and eye-direction changes. In cells 6 and 7, interpolate gradually from that bowed-down pose toward the final upper-left endpoint; never jump directly to a fully raised side pose.
