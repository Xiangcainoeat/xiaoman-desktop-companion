# Xiaoman Look Mechanics

## Natural Motion

Xiaoman is a compact stylized Siamese cat with large physical eyeballs, a distinct head and neck, upright ears, a flexible tail, and four grounded paws. Looking begins with both complete eyeballs rotating inside their sockets: iris, pupil, sclera rim, eyelids, and highlights move together. The head and neck follow with a restrained yaw or pitch, the ears follow the skull with slight lag, and the upper shoulders shift subtly. The paws, lower torso, body scale, and baseline remain anchored. The tail may counter-sway by a very small amount but never changes sides or teleports.

Do not rotate, skew, or tilt the whole sprite. Preserve the original eye construction; do not add replacement whites, floating pupils, or googly eyes. Xiaoman has no prop.

## Cardinal Pose Families

- **000 up:** Both eyes and pupils aim upward, the chin lifts, the muzzle angles slightly up, the neck and upper chest lengthen, and both ears tip back a little. The pose remains balanced and clearly differs from neutral.
- **090 screen-right:** Nose tip and both pupils move unmistakably to screen-right. The head yaws right, the screen-left cheek and shoulder become more visible, and the far screen-right eye narrows slightly through natural occlusion. The lower body stays fixed.
- **180 down:** Both eyes and pupils aim down, the head bows, more of the crown is visible, the muzzle shortens through foreshortening, and the shoulders compress slightly. This is attention downward, not sadness or failure.
- **270 screen-left:** Nose tip and both pupils move unmistakably to screen-left. The head yaws left, the screen-right cheek and shoulder become more visible, and the far screen-left eye narrows slightly through natural occlusion. The lower body stays fixed.

## Motion Budget And Continuity

Each 22.5-degree step changes the eye rotation first, then head yaw or pitch by a small even increment, then ears and shoulders by a smaller follow-through. Lateral torso movement stays below roughly 3 percent of a final cell, tail movement below roughly 2 percent, and scale remains constant. No adjacent step may flip the head, swap visible cheeks, jump the tail, change facial proportions, or move the paws.

Row 9 follows 000 -> 090 -> 180 through the screen-right side. Row 10 follows 180 -> 270 -> 000 through the screen-left side. The 157.5 -> 180 and 337.5 -> 000 boundaries must each be exactly one small step. Cardinals are screen-coordinate directions, never character-relative directions.
