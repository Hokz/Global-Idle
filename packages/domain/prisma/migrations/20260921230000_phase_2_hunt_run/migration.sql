-- Phase 2 — the Hunt run. Spec §9.
--
-- HAND-WRITTEN, like Phase 1's, and for the same reason: the generated form
-- gets the parts that matter wrong. Here it is the CHECK constraints and the
-- ON DELETE behaviour, neither of which Prisma emits from the schema, and both
-- of which are the difference between an invariant and a comment.

-- ───────────────────────────────────────────────────────────────────────────
-- Character: durable Base XP (spec §9)
-- ───────────────────────────────────────────────────────────────────────────

-- BIGINT because the Canary curve reaches 2^31 around level 1700 and the
-- product has no level cap. A column that overflows is a migration nobody
-- scheduled.
ALTER TABLE "Character" ADD COLUMN "baseXp" BIGINT NOT NULL DEFAULT 0;

-- XP only ever accrues. A negative total is a defect in whatever wrote it,
-- and the database is where that gets caught rather than surfacing as a
-- level that went backwards.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_baseXp_check" CHECK ("baseXp" >= 0);

-- ───────────────────────────────────────────────────────────────────────────
-- HuntRun: the POSITION of a simulation, not a process running it
-- ───────────────────────────────────────────────────────────────────────────

CREATE TYPE "HuntEndReason" AS ENUM ('DIED', 'LEFT', 'GRACE_EXPIRED');

CREATE TABLE "HuntRun" (
    "activityId"              TEXT          NOT NULL,
    "characterId"             TEXT          NOT NULL,
    "room"                    INTEGER       NOT NULL,
    "cycle"                   INTEGER       NOT NULL DEFAULT 0,
    "tick"                    INTEGER       NOT NULL,
    "simulatedThrough"        TIMESTAMP(3)  NOT NULL,
    "characterHealth"         INTEGER       NOT NULL,
    "characterNextAttackTick" INTEGER       NOT NULL DEFAULT 0,
    "supplyCharges"           INTEGER       NOT NULL,
    "creatures"               JSONB         NOT NULL,
    "sessionXp"               BIGINT        NOT NULL DEFAULT 0,
    "sessionGold"             BIGINT        NOT NULL DEFAULT 0,
    "checkpointSequence"      INTEGER       NOT NULL DEFAULT 0,
    "lastSeenAt"              TIMESTAMP(3)  NOT NULL,
    "endedReason"             "HuntEndReason",
    "endedAt"                 TIMESTAMP(3),

    CONSTRAINT "HuntRun_pkey" PRIMARY KEY ("activityId")
);

CREATE INDEX "HuntRun_characterId_idx" ON "HuntRun" ("characterId");

-- ON DELETE RESTRICT on both: an Activity and a Character are never deleted
-- (ADR-007, I12), and a run that outlived either of them would be a record of
-- something that never happened.
ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The invariants a simulation position has to satisfy for the numbers derived
-- from it to mean anything.
ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_progress_check"
  CHECK ("room" >= 1 AND "cycle" >= 0 AND "tick" >= 0 AND "checkpointSequence" >= 0);

ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_resources_check"
  CHECK ("characterHealth" >= 0 AND "supplyCharges" >= 0);

-- Session totals are a display of what was already awarded durably; they can
-- no more go backwards than the ledger can.
ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_session_check"
  CHECK ("sessionXp" >= 0 AND "sessionGold" >= 0);

-- An ended run has both fields or neither. Half of an ending is a run nothing
-- can classify.
ALTER TABLE "HuntRun"
  ADD CONSTRAINT "HuntRun_ended_check"
  CHECK (("endedReason" IS NULL) = ("endedAt" IS NULL));
