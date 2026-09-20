// Public surface of the activity bounded context (ADR-001, ADR-018).
//
// This file is the ONLY legal entry point. Reaching past it into a sibling
// file is a dependency-cruiser violation, inside this package as much as
// across it (§4.1, tests W8 and W11).
export const CONTEXT_NAME = 'activity' as const;
