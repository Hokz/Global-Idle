-- ADR-019, corrected — POUCH ownership is REFERENTIAL, not a naming convention.
--
-- The first custody migration checked only `subjectId <> accountId` for a
-- POUCH row. That is not ownership. It accepted a pouch whose subject was a
-- string nobody had ever issued, and it accepted Account A holding a pouch for
-- a Character owned by Account B. Both would have been money the ledger could
-- not attribute, which is the one thing a ledger exists to prevent.
--
-- What replaces it says the same sentence in a way the database can enforce:
--
--   * an explicit `characterId`, NULL for BANK and NOT NULL for POUCH;
--   * a COMPOSITE foreign key (characterId, accountId) -> Character(id, accountId),
--     so the Character must exist AND must belong to the account on the row;
--   * a CHECK tying `custody` to both `characterId` and `subjectId`, so the
--     projection key cannot drift away from the owner the foreign key proved.
--
-- The composite target is why `Character(id, accountId)` gains a UNIQUE index:
-- `id` alone was already unique, so the index constrains nothing new — it
-- exists to be POINTED AT. And because the pair is MATCH SIMPLE, a BANK row
-- with `characterId IS NULL` skips the foreign key entirely rather than
-- needing an exemption.
--
-- Nothing here creates, destroys or moves value, and I6 is intact: the backfill
-- below fills a column that did not exist a statement earlier, touching no
-- amount, reason code or operation id, and it runs as the MIGRATION role. The
-- application role's `REVOKE UPDATE, DELETE ON "LedgerEntry"` is untouched, so
-- the ledger stays append-only for every path that is not a schema change.

-- ───────────────────────────────────────────────────────────────────────────
-- The composite target
-- ───────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "Character_id_accountId_key" ON "Character"("id", "accountId");

-- ───────────────────────────────────────────────────────────────────────────
-- The owner column, and the backfill that makes it true of existing rows
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "LedgerEntry" ADD COLUMN "characterId" TEXT;
ALTER TABLE "CurrencyBalance" ADD COLUMN "characterId" TEXT;

-- Every BANK row keeps NULL, which is what it already meant. Every POUCH row
-- already carried its Character in `subjectId`; this only makes that explicit,
-- so the foreign key below has a column to check. If any POUCH row named a
-- Character that does not exist or belongs to another account, the foreign key
-- creation at the end of this migration FAILS — which is the correct outcome:
-- the corruption this constraint exists to prevent is not silently retained.
UPDATE "LedgerEntry"     SET "characterId" = "subjectId" WHERE "custody" = 'POUCH';
UPDATE "CurrencyBalance" SET "characterId" = "subjectId" WHERE "custody" = 'POUCH';

-- ───────────────────────────────────────────────────────────────────────────
-- The CHECK that was misleading, replaced by one that is not
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "LedgerEntry"     DROP CONSTRAINT "LedgerEntry_custody_subject_check";
ALTER TABLE "CurrencyBalance" DROP CONSTRAINT "CurrencyBalance_custody_subject_check";

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_custody_subject_check"
  CHECK (
    ("custody" = 'BANK'  AND "characterId" IS NULL     AND "subjectId" = "accountId") OR
    ("custody" = 'POUCH' AND "characterId" IS NOT NULL AND "subjectId" = "characterId")
  );

ALTER TABLE "CurrencyBalance"
  ADD CONSTRAINT "CurrencyBalance_custody_subject_check"
  CHECK (
    ("custody" = 'BANK'  AND "characterId" IS NULL     AND "subjectId" = "accountId") OR
    ("custody" = 'POUCH' AND "characterId" IS NOT NULL AND "subjectId" = "characterId")
  );

-- ───────────────────────────────────────────────────────────────────────────
-- The referential integrity itself
-- ───────────────────────────────────────────────────────────────────────────
--
-- RESTRICT on delete rather than SET NULL, and the difference matters: SET
-- NULL would silently orphan a pouch into a shape the CHECK above forbids, so
-- the failure would surface later and somewhere else. ADR-007/I12 says a
-- Character is retired, never hard-deleted; this makes that a database fact
-- for any Character that has ever carried Gold.

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_characterId_accountId_fkey"
  FOREIGN KEY ("characterId", "accountId") REFERENCES "Character"("id", "accountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CurrencyBalance" ADD CONSTRAINT "CurrencyBalance_characterId_accountId_fkey"
  FOREIGN KEY ("characterId", "accountId") REFERENCES "Character"("id", "accountId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
