# Shared terrain types

The stable shared model currently lives in `src/domain/` while the repository is a single desktop package. This package boundary is reserved for the point at which native Rust commands or the future Studio plugin need to consume the versioned project contract without importing UI code.
