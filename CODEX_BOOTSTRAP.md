# Codex Bootstrap

Use this as the first prompt/context when opening the repository in Codex.

## Instruction

Read the repository documentation completely before changing code.

Start with:

- `AGENTS.md`
- `docs/MASTER_DEVELOPMENT_ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/MVP_SCOPE.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

Then inspect the repository state and report:

1. current branch and git status;
2. current repository structure;
3. what Phase 0 already contains;
4. what is missing before the technical skeleton can be created;
5. any conflicts between documentation files.

Do **not** implement gameplay immediately.

When authorized to start Phase 0 implementation, the first engineering target is:

- monorepo/workspace;
- web app;
- API;
- PostgreSQL;
- Redis;
- ORM/migrations;
- shared types;
- game-data package;
- game-engine/simulation package boundary;
- Docker Compose;
- health checks;
- CI skeleton.

Do not implement Market, Forge, Wheel, bosses or full combat before the Phase 0 foundation is reviewed.
