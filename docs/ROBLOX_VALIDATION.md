# Roblox validation

The export contract follows Roblox Creator Hub's Terrain guidance: one heightmap pixel represents 4 studs, and heightmaps are supported up to 4,096 × 4,096 pixels. Solum exports a grayscale heightmap, a matching colormap, and a JSON manifest with dimensions and elevation mapping.

## Manual Studio check

1. Create a deterministic Solum project with a flat basin, a rolling hill, a tall peak, a valley, and at least three material regions.
2. Export the heightmap and colormap using the export controls.
3. In Roblox Studio, open Terrain Editor → Create → Import.
4. Select the heightmap and optional colormap, import, and compare X/Z orientation, elevation range, and material boundaries with Solum.
5. Record the Studio version and any import differences in the validation issue before claiming acceptance.

Studio validation has not been performed by the current automated environment.
