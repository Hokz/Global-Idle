// Contracts and pure helpers shared across the workspace (§4, OPERATIONS_ARCHITECTURE.md §1).
// Named `shared`, not `shared-types`: it holds contracts and pure helpers, not only types.
//
// This package imports no other workspace package, no framework and no I/O
// (§5.2). 0B.4 fills it with identifiers, result types and domain constants.
export const SHARED_PACKAGE = '@global-idle/shared' as const;
