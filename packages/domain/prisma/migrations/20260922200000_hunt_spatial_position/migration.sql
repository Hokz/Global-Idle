-- Phase 3.5 — the Character's authoritative TILE.
--
-- One nullable column, because space is a property of a Hunt that HAS a map
-- and every Phase 2 fixture simulates one that does not. The creature array
-- needed no migration at all: it was already an opaque engine snapshot, so the
-- actor id and its tile ride along inside it.
--
-- What is NOT here, deliberately: pixels, camera, animation frame, or an
-- interpolated position. Those are the renderer's, they are recomputed from
-- this every frame, and persisting them would make the browser's opinion
-- durable.

ALTER TABLE "HuntRun" ADD COLUMN "position" JSONB;
