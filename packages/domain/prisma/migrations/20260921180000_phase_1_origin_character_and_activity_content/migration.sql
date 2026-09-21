-- Phase 1 — World / Character vertical slice. Spec §13.2 and §13.3.
--
-- HAND-WRITTEN, for two reasons a generated migration gets wrong:
--
-- 1. `prisma migrate diff` emits `ADD COLUMN "contentKey" TEXT NOT NULL`,
--    which fails on a non-empty table with a generic error. §13.3 requires
--    the three-step form below so the failure is READABLE and so that no
--    value is ever fabricated for a pre-Phase-1 Activity.
--
-- 2. It also proposes dropping and recreating
--    "SessionBoundActivity_accountId_key" (invariant I9). The two definitions
--    are IDENTICAL -- `state IN (...)` versus `state = ANY (ARRAY[...])` --
--    and Prisma simply cannot see that. Dropping a Phase 0B uniqueness
--    constraint to satisfy a formatting difference is not something this
--    phase does, so it is deliberately absent.

-- ───────────────────────────────────────────────────────────────────────────
-- Character: the ORIGIN Character (spec §13.2)
-- ───────────────────────────────────────────────────────────────────────────

-- The origin Character has not chosen a vocation yet. NULL means NOT CHOSEN;
-- it is not a sixth vocation.
ALTER TABLE "Character" ALTER COLUMN "vocation" DROP NOT NULL;

ALTER TABLE "Character" ADD COLUMN "baseLevel" INTEGER NOT NULL DEFAULT 1;

-- The floor is the constraint; the default exists only so the column can be
-- added to existing rows.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_baseLevel_check" CHECK ("baseLevel" >= 1);

-- I1b -- at most ONE playable un-vocationalized Origin Character per account.
-- I1 (Character_accountId_vocation_key) is untouched and still refuses two
-- playable Knights; it cannot constrain NULLs, because a unique index treats
-- them as distinct. That is what this index is for.
CREATE UNIQUE INDEX "Character_accountId_key"
    ON "Character" ("accountId")
 WHERE "retiredAt" IS NULL AND "vocation" IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- Activity: durable content identity (spec §9.5, §13.3)
-- ───────────────────────────────────────────────────────────────────────────

-- 1. nullable for the moment it takes to reach step 3.
ALTER TABLE "Activity" ADD COLUMN "contentKey" TEXT;

-- 2. NO BACKFILL. A pre-Phase-1 Activity records activityTypeKey = 'hunt' and
--    a contentVersion and NOTHING that says which definition it ran. There is
--    no truthful value, and an invented one ('', 'legacy', 'unknown') would
--    put a false fact in the column reload depends on.

-- 3. Tighten. This FAILS on a database that still holds Activity rows, which
--    is the intended behaviour: there is no production deployment, every
--    existing Activity is a Testcontainers, seed or scratch row, and the
--    remedy is `pnpm infra:down && pnpm dev`. Refusing with an error a
--    developer can read beats a fabricated backfill or a column that stays
--    nullable forever -- which would permit an Activity that cannot say what
--    it is, the exact defect §9.5 removes.
ALTER TABLE "Activity" ALTER COLUMN "contentKey" SET NOT NULL;

-- The SHAPE of a content key, checked where I1 and I2 are checked: the
-- database, not a caller that forgets. This is the POSIX translation of
-- KEY_PATTERN in packages/game-data/src/keys.ts -- the same rule, so the two
-- cannot drift into disagreeing about what a key is. KIND compatibility
-- (is this key a `hunt`?) lives in a content bundle, not in a table, so it is
-- enforced in the creation transaction instead.
ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_contentKey_format_check"
  CHECK ("contentKey" ~ '^[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)+$');

-- Reload reads the pair together.
CREATE INDEX "Activity_contentVersion_contentKey_idx"
    ON "Activity" ("contentVersion", "contentKey");
