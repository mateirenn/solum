# Terrain model

Roblox terrain is treated as a 4-stud sample grid. A project with a 16,384 × 16,384 stud footprint therefore uses a 4,096 × 4,096 sample map. The constants live in `src/domain/roblox.ts`.

Heights are stored as normalized floats in `[0, 1]`. World elevation is centralized as:

```text
worldHeight = minElevation + normalizedHeight × (maxElevation - minElevation)
```

The base layer is absolute normalized height. Additional height layers are signed normalized deltas. Their visible contribution is `delta × opacity`, and the composed result is clamped to `[0, 1]`. Visibility and opacity affect the composed terrain that drives the viewport, 3D preview, slope readout, rules, and export.

The current editor uses a single contiguous typed-array per layer for a compact, predictable MVP. Brush history stores changed indices and before/after values rather than cloning the full project. Version 2 `.rterrain` files serialize these fields as validated 256 × 256 base64 tiles, but the runtime still materializes contiguous arrays and refreshes complete CPU bitmaps.

Material layers are ordered, non-destructive coverage fields. A visible layer contributes its selected Roblox material when `coverage × opacity >= 0.5`; otherwise compositing falls through to the next layer and then the base material map. The grayscale protection mask uses `1` for editable and `0` for fully protected samples. Height and material brush edits, including material-layer coverage painting, are multiplied by the mask; fully protected samples are also preserved by material-rule evaluation.

Rectangular selections are transient editor constraints expressed in sample coordinates. Brush, biome, and corridor operations skip samples outside the active selection. Biome presets are deterministic material distributions keyed from the project seed. Road and river splines use click-placed sample-coordinate control points and write blended signed deltas into a new height layer; roads grade toward an interpolated path elevation with a preferred maximum grade, while rivers carve a depth-weighted channel and banks. Both operations honor the protection mask and can be undone as layer creation/removal.

The slope brush is a local grade-enforcement pass. For each affected sample it compares the composed height with its four cardinal neighbors, converts the configured maximum grade through the 4-stud sample spacing, and pulls only over-grade samples toward the allowed boundary. It is a real height edit, not a display blur, and participates in the same changed-sample undo path as other brush tools.

Coordinates use image X → Roblox X and image Y → Roblox Z. Display and export use the same orientation; there is no scattered vertical flip.
