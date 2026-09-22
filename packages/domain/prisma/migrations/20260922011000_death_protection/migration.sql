-- Phase 2 correction — the death policy seam.
--
-- Two columns, and the constraints that stop them lying. Nothing in this phase
-- writes anything but the defaults; the point is that the policy READS
-- protection from authoritative state instead of assuming it, so the blessing
-- shop and the Oracle attach here rather than editing the Hunt.

ALTER TABLE "Character" ADD COLUMN "blessings" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "promoted" BOOLEAN NOT NULL DEFAULT false;

-- Canary counts blessings 2 through 8: seven of them, and Twist of Fate is not
-- one. An eighth would silently change every death in the game.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_blessings_check"
  CHECK ("blessings" >= 0 AND "blessings" <= 7);

-- A vocation-less Character cannot be promoted. This is the SOURCE's answer,
-- not a Global Idle rule: `Vocations::getPromotedVocation(0)` returns
-- VOCATION_NONE, so `Player::isPromoted()` is false for vocation 0. Enforcing
-- it here means a future Oracle cannot half-promote an Origin Character and
-- quietly hand it a 30-point death discount it never earned.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_promotion_requires_vocation_check"
  CHECK ("vocation" IS NOT NULL OR "promoted" = false);
