-- ADR-019 — currency lives in custody scopes, and the ledger says which.
--
-- HAND-WRITTEN, like the migrations before it, because the parts that matter
-- are the ones Prisma does not emit: the backfill that preserves every
-- existing balance, and the CHECK that stops a BANK row claiming to belong to
-- a Character.
--
-- Nothing here creates or destroys value. Every existing row becomes a BANK
-- row whose subject is its own account, which is exactly what it already was.

CREATE TYPE "CurrencyCustody" AS ENUM ('BANK', 'POUCH');

-- ───────────────────────────────────────────────────────────────────────────
-- LedgerEntry — every entry now says where the value sat
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "LedgerEntry" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "custody" "CurrencyCustody";

-- Everything written before this migration was account-scoped safe Gold.
UPDATE "LedgerEntry" SET "subjectId" = "accountId", "custody" = 'BANK';

ALTER TABLE "LedgerEntry" ALTER COLUMN "subjectId" SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "custody" SET NOT NULL;

-- A BANK entry belongs to its account; a POUCH entry belongs to something
-- else, which is a Character. The database says so rather than trusting every
-- call site to remember.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_custody_subject_check"
  CHECK (
    ("custody" = 'BANK'  AND "subjectId" =  "accountId") OR
    ("custody" = 'POUCH' AND "subjectId" <> "accountId")
  );

CREATE INDEX "LedgerEntry_subjectId_custody_currency_createdAt_idx"
  ON "LedgerEntry" ("subjectId", "custody", "currency", "createdAt");

-- ───────────────────────────────────────────────────────────────────────────
-- CurrencyBalance — one projection per scope
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "CurrencyBalance" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "CurrencyBalance" ADD COLUMN "custody" "CurrencyCustody";

UPDATE "CurrencyBalance" SET "subjectId" = "accountId", "custody" = 'BANK';

ALTER TABLE "CurrencyBalance" ALTER COLUMN "subjectId" SET NOT NULL;
ALTER TABLE "CurrencyBalance" ALTER COLUMN "custody" SET NOT NULL;

-- The key widens rather than moves: (account, currency) was always
-- (subject, BANK, currency) with the scope left implicit.
ALTER TABLE "CurrencyBalance" DROP CONSTRAINT "CurrencyBalance_pkey";
ALTER TABLE "CurrencyBalance"
  ADD CONSTRAINT "CurrencyBalance_pkey" PRIMARY KEY ("subjectId", "custody", "currency");

ALTER TABLE "CurrencyBalance"
  ADD CONSTRAINT "CurrencyBalance_custody_subject_check"
  CHECK (
    ("custody" = 'BANK'  AND "subjectId" =  "accountId") OR
    ("custody" = 'POUCH' AND "subjectId" <> "accountId")
  );

CREATE INDEX "CurrencyBalance_accountId_currency_idx"
  ON "CurrencyBalance" ("accountId", "currency");
