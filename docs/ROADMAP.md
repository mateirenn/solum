# Roadmap

Highest-value follow-ups:

1. Replace the in-memory contiguous arrays with the existing 256 × 256 file tile boundary, then add a native repository; native file/recovery I/O is already atomic and off the Tauri command thread.
2. Move current browser image/colormap import and recovery flows into non-blocking native workers/storage.
3. Add reusable stamps, freeform selections, editable persistent spline metadata, and material bed/bank assignment.
4. Add a native Rust operation service for large-map brush, rule, import/export, and analysis work.
5. Run a packaged Windows QA pass at 100%, 125%, and 150% scaling, including 4,096² performance scenarios.
6. Extend the current module worker path with tile-backed snapshots and background statistics; the current rules, biome, and procedural operations already expose progress/cancel controls.
7. Validate exported terrain in Roblox Studio and record versioned evidence.

Direct Studio live sync, a plugin, accounts, cloud storage, AI features, and telemetry are intentionally out of scope for V1.
