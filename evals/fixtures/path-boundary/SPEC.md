# Lexical workspace path boundary

Implement `resolveWorkspacePath(root, requested)` so the returned absolute path
is lexically inside `root` or equal to it. Reject traversal, absolute paths
outside the root, and sibling paths whose names merely share the root prefix.

This fixture tests lexical validation only; filesystem existence and symlink
resolution are outside its contract. Keep the exported function name unchanged.
