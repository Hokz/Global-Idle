// The Content bounded context (ADR-001, ADR-011, §10).
//
// Build-time, versioned and read-only at runtime, which is why it is its own
// package rather than a directory under domain. It imports no app, no engine,
// no domain and no framework (§5.2).
export const GAME_DATA_PACKAGE = '@global-idle/game-data' as const;
