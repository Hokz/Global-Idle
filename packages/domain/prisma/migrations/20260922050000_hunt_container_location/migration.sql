-- HUNT_CONTAINER — the enum value, alone, on purpose.
--
-- PostgreSQL will not let a transaction USE an enum value it added itself, and
-- Prisma runs each migration file in one transaction. The custody change that
-- follows has to write 'HUNT_CONTAINER' into existing rows, so the value has
-- to be committed first. One statement, its own migration, for that reason.

ALTER TYPE "ItemLocation" ADD VALUE 'HUNT_CONTAINER';
