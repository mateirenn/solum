# `.rterrain` project format

The current `.rterrain` format is a versioned UTF-8 JSON container saved as a single portable file. Version 2 stores height and material data as row-major 256 × 256 tile records encoded as base64 bytes. Edge tiles contain only their actual width and height. Float32 height bytes are little-endian, matching the Windows desktop target; the decoder validates every tile's count, byte length, and height finiteness before opening it. The live editor uses the same tile size through sparse `TileBackedBuffer` instances, so empty tiles are not allocated and serialization reads one tile at a time.

```json
{
  "schemaVersion": 2,
  "storage": "tiles-v1",
  "tileSize": 256,
  "name": "My map",
  "width": 512,
  "height": 512,
  "minElevation": 0,
  "maxElevation": 1024,
  "seaLevel": 128,
  "seed": 42,
  "baseTiles": ["<base64 tile bytes>"],
  "layers": [],
  "materialTiles": ["<base64 tile bytes>"],
  "materialLayers": [],
  "maskTiles": ["<base64 Float32 coverage tiles>"]
}
```

Each material layer stores a fixed Roblox material index plus a tiled Float32 coverage field (`coverageTiles`). The ordered layer list is composited top-to-bottom over the base material map; visibility and opacity are persisted. Version 1 files with expanded `base`, `layers[].values`, and `materials` arrays remain readable and are upgraded to the tiled representation on the next save. Tiling reduces JSON number overhead and gives the future native repository a stable chunk boundary. Native save/recovery and export have asynchronous tile/row paths, and native writes use same-directory temporary files with atomic replacement on Windows. SQLite/compression, persistent dirty-tile commits, and native GPU texture uploads remain future storage/runtime work.
The project-level `maskTiles` field is a grayscale Float32 protection mask: `1` permits edits and `0` fully protects samples. The Mask tool can protect or reveal coverage, and height/material brush operations multiply their effect by the current coverage.
