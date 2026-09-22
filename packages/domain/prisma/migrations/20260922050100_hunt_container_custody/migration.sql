-- ───────────────────────────────────────────────────────────────────────────
-- Active Hunt containers become a real custody, with ownership the database
-- can check (Phase 3 spec §3.1, correction finding 1)
-- ───────────────────────────────────────────────────────────────────────────
--
-- What was here before: the starting backpack sat at EQUIPPED/BACKPACK and a
-- `CharacterContainerSlot` row pointed at it by id. Four things that had to be
-- true were nobody's to enforce.
--
--   * one Character wears ONE backpack, but installs up to FIVE containers, so
--     EQUIPPED/BACKPACK could never have represented slots 2 to 5 at all;
--   * a slot could name a container belonging to a DIFFERENT Character, or to
--     a different Account, and the single-column foreign key was satisfied;
--   * a container could be moved to the Depot while its slot still pointed at
--     it, leaving an ACTIVE slot holding something that was not there;
--   * contents could name one Character while their parent container named
--     another.
--
-- After this migration none of those rows can be written. `slotIndex` on the
-- instance is what makes it possible: the slot's foreign key names the
-- container, its owner AND the slot it claims to be in, so "installed" is a
-- fact both rows agree on rather than a pointer one of them holds.

-- ── the pointers are replaced, so the old ones go first ────────────────────
ALTER TABLE "ItemInstance"           DROP CONSTRAINT "ItemInstance_containerId_fkey";
ALTER TABLE "CharacterContainerSlot" DROP CONSTRAINT "CharacterContainerSlot_containerInstanceId_fkey";

ALTER TABLE "ItemInstance" ADD COLUMN "slotIndex" INTEGER;

-- The old shape CHECK knows four locations and none of them is the one the
-- backfill is about to write, so it goes FIRST. Its replacement is added below,
-- once every row is in a shape the new one accepts.
ALTER TABLE "ItemInstance" DROP CONSTRAINT "ItemInstance_location_shape_check";

-- ── every already-installed container moves to its real custody ────────────
--
-- Read from the slot table, which is the only place that knew. After this no
-- installed container is EQUIPPED, so the equipment slot index below stops
-- being the thing that limited a Character to one.
UPDATE "ItemInstance" AS i
   SET "location"  = 'HUNT_CONTAINER',
       "slot"      = NULL,
       "slotIndex" = s."slotIndex"
  FROM "CharacterContainerSlot" AS s
 WHERE s."containerInstanceId" = i."id"
   AND i."location" = 'EQUIPPED';

-- ── the shape, with the new custody in it ──────────────────────────────────
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_location_shape_check"
  CHECK (
    ("location" = 'EQUIPPED'
       AND "characterId" IS NOT NULL AND "containerId" IS NULL     AND "slot" IS NOT NULL AND "slotIndex" IS NULL) OR
    ("location" = 'HUNT_CONTAINER'
       AND "characterId" IS NOT NULL AND "containerId" IS NULL     AND "slot" IS NULL     AND "slotIndex" IS NOT NULL) OR
    ("location" = 'CHARACTER_CONTAINER'
       AND "characterId" IS NOT NULL AND "containerId" IS NOT NULL AND "slot" IS NULL     AND "slotIndex" IS NULL) OR
    ("location" = 'LOOT_POUCH'
       AND "characterId" IS NOT NULL AND "containerId" IS NULL     AND "slot" IS NULL     AND "slotIndex" IS NULL) OR
    ("location" = 'DEPOT'
       AND "characterId" IS NULL     AND "containerId" IS NULL     AND "slot" IS NULL     AND "slotIndex" IS NULL)
  );

-- There is no slot 6 on this side of the pairing either.
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_slotIndex_check"
  CHECK ("slotIndex" IS NULL OR "slotIndex" BETWEEN 1 AND 5);

-- ── the indexes the composite keys point at ────────────────────────────────
CREATE UNIQUE INDEX "ItemInstance_characterId_slotIndex_key"
    ON "ItemInstance"("characterId", "slotIndex") WHERE ("location" = 'HUNT_CONTAINER');
CREATE UNIQUE INDEX "ItemInstance_id_characterId_key"
    ON "ItemInstance"("id", "characterId");
CREATE UNIQUE INDEX "ItemInstance_id_characterId_slotIndex_key"
    ON "ItemInstance"("id", "characterId", "slotIndex");
CREATE UNIQUE INDEX "CharacterContainerSlot_containerInstanceId_characterId_slot_key"
    ON "CharacterContainerSlot"("containerInstanceId", "characterId", "slotIndex");

-- ── contents belong to the same Character as their parent ──────────────────
--
-- The PAIR is checked, not the id alone. Two consequences, both wanted: a
-- Character-B potion cannot sit in a Character-A backpack, and a container
-- holding anything cannot be moved to the Depot — its own characterId would
-- have to become null while its contents still name it.
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_containerId_characterId_fkey"
  FOREIGN KEY ("containerId", "characterId") REFERENCES "ItemInstance"("id", "characterId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── an installed container, its owner and its slot, in one key ─────────────
--
-- A Depot container has a null characterId and the slot's is NOT NULL, so it
-- cannot be installed. Another Character's container has a different one, so
-- it cannot be installed. And a container that left slot 3 no longer matches
-- the row that says it is in slot 3, so the move is refused unless the slot is
-- cleared in the SAME transaction. RESTRICT rather than SET NULL: silently
-- emptying the slot is the behaviour this whole migration exists to remove.
ALTER TABLE "CharacterContainerSlot"
  ADD CONSTRAINT "CharacterContainerSlot_containerInstanceId_characterId_slo_fkey"
  FOREIGN KEY ("containerInstanceId", "characterId", "slotIndex")
  REFERENCES "ItemInstance"("id", "characterId", "slotIndex")
  ON DELETE RESTRICT ON UPDATE CASCADE;
