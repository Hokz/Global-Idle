// Pure simulation (ADR-010, §9).
//
// No I/O of any kind. Time is a parameter, randomness is injected and seeded,
// content arrives already resolved, and output DESCRIBES change rather than
// applying it. 0B.3's dependency-cruiser run and test E3 prove the module
// graph contains no forbidden import; 0B.5 adds the deterministic proof.
export const GAME_ENGINE_PACKAGE = '@global-idle/game-engine' as const;
