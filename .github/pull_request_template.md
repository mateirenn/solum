## What changed?

<!-- Describe the user-visible change and why it belongs in Solum. -->

## Source-of-truth boundary

- [ ] Persistent terrain state remains owned by the domain model.
- [ ] Rendered Pixi/Three state is still only a representation.
- [ ] No unreviewed account, telemetry, AI, network, or arbitrary shell behavior was added.

## Validation

- [ ] `pnpm verify`
- [ ] `pnpm tauri dev` (when desktop behavior changed)
- [ ] `pnpm tauri build` (when packaging or native behavior changed)
- [ ] Docs/status table updated if feature boundaries changed.

## Remaining limits

<!-- Call out anything that still needs packaged Windows or Roblox Studio validation. -->

