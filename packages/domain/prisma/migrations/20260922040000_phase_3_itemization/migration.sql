-- Phase 3 — physical items, containers, the Stash and the Loot Policy.
--
-- HAND-WRITTEN around Prisma's generated DDL, as every migration in this
-- repository is, because the parts that matter are the ones Prisma does not
-- emit: the CHECK constraints that make an illegal custody UNREPRESENTABLE
-- rather than merely refused by a service that might forget.
--
-- The rule the whole phase rests on: ONE ROW IS ONE PHYSICAL THING, and it is
-- in exactly one place. Everything below is that sentence in SQL.


-- CreateEnum
CREATE TYPE "ItemLocation" AS ENUM ('EQUIPPED', 'CHARACTER_CONTAINER', 'LOOT_POUCH', 'DEPOT');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'SEMI_RARE', 'RARE', 'MYSTIC', 'LEGENDARY', 'STELLAR');

-- CreateEnum
CREATE TYPE "EquipmentSlot" AS ENUM ('HEAD', 'NECKLACE', 'BACKPACK', 'ARMOR', 'RIGHT', 'LEFT', 'LEGS', 'FEET', 'RING', 'AMMO');

-- CreateEnum
CREATE TYPE "LootPolicyMode" AS ENUM ('COLLECT_ALL_EXCEPT_SKIPPED', 'ACCEPTED_ONLY');

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "characterId" TEXT,
    "definitionKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "location" "ItemLocation" NOT NULL,
    "slot" "EquipmentSlot",
    "containerId" TEXT,
    "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
    "affixes" JSONB NOT NULL DEFAULT '[]',
    "forgeTier" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterContainerSlot" (
    "characterId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "containerInstanceId" TEXT,
    "routingCategory" TEXT,

    CONSTRAINT "CharacterContainerSlot_pkey" PRIMARY KEY ("characterId","slotIndex")
);

-- CreateTable
CREATE TABLE "StashEntry" (
    "accountId" TEXT NOT NULL,
    "definitionKey" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StashEntry_pkey" PRIMARY KEY ("accountId","definitionKey")
);

-- CreateTable
CREATE TABLE "CharacterLootPolicy" (
    "characterId" TEXT NOT NULL,
    "mode" "LootPolicyMode" NOT NULL DEFAULT 'COLLECT_ALL_EXCEPT_SKIPPED',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterLootPolicy_pkey" PRIMARY KEY ("characterId")
);

-- CreateIndex
CREATE INDEX "ItemInstance_accountId_location_idx" ON "ItemInstance"("accountId", "location");

-- CreateIndex
CREATE INDEX "ItemInstance_characterId_location_idx" ON "ItemInstance"("characterId", "location");

-- CreateIndex
CREATE INDEX "ItemInstance_containerId_idx" ON "ItemInstance"("containerId");

-- CreateIndex
CREATE INDEX "ItemInstance_accountId_definitionKey_idx" ON "ItemInstance"("accountId", "definitionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ItemInstance_characterId_slot_key" ON "ItemInstance"("characterId", "slot") WHERE ("location" = 'EQUIPPED');

-- CreateIndex
CREATE UNIQUE INDEX "CharacterContainerSlot_containerInstanceId_key" ON "CharacterContainerSlot"("containerInstanceId");

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_characterId_accountId_fkey" FOREIGN KEY ("characterId", "accountId") REFERENCES "Character"("id", "accountId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "ItemInstance"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CharacterContainerSlot" ADD CONSTRAINT "CharacterContainerSlot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterContainerSlot" ADD CONSTRAINT "CharacterContainerSlot_containerInstanceId_fkey" FOREIGN KEY ("containerInstanceId") REFERENCES "ItemInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StashEntry" ADD CONSTRAINT "StashEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLootPolicy" ADD CONSTRAINT "CharacterLootPolicy_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────────────────────────────────────────────────────────────────────
-- Custody — one instance, one place
-- ───────────────────────────────────────────────────────────────────────────
--
-- Each location fixes exactly which of characterId, containerId and slot may
-- be set. "Equipped AND sitting in a backpack" is not rejected at runtime; it
-- cannot be written.

ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_location_shape_check"
  CHECK (
    ("location" = 'EQUIPPED'
       AND "characterId" IS NOT NULL AND "containerId" IS NULL     AND "slot" IS NOT NULL) OR
    ("location" = 'CHARACTER_CONTAINER'
       AND "characterId" IS NOT NULL AND "containerId" IS NOT NULL AND "slot" IS NULL) OR
    ("location" = 'LOOT_POUCH'
       AND "characterId" IS NOT NULL AND "containerId" IS NULL     AND "slot" IS NULL) OR
    ("location" = 'DEPOT'
       AND "characterId" IS NULL     AND "containerId" IS NULL     AND "slot" IS NULL)
  );

-- A stack of 0 is not an empty stack, it is a bug that has not surfaced yet.
-- The upper bound is maxStack, which is content and therefore enforced in the
-- domain; 255 is the ceiling no definition may exceed (source map §5).
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_quantity_check"
  CHECK ("quantity" >= 1 AND "quantity" <= 255);

-- A container inside a container is the whole nesting exploit, expressed once.
-- Containers live in top-level slots; nothing lives inside one but its
-- contents. The self-reference guard is the cheap half of the same sentence.
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_no_self_containment_check"
  CHECK ("containerId" IS NULL OR "containerId" <> "id");

-- Reserved, and reserved honestly: nothing in Phase 3 writes it.
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_forgeTier_check"
  CHECK ("forgeTier" >= 0);

-- ───────────────────────────────────────────────────────────────────────────
-- Exactly five top-level Hunt Container Slots
-- ───────────────────────────────────────────────────────────────────────────
--
-- There is no slot 6. Not "the service refuses one" — there is no row shape
-- that could hold it.

ALTER TABLE "CharacterContainerSlot"
  ADD CONSTRAINT "CharacterContainerSlot_index_check"
  CHECK ("slotIndex" BETWEEN 1 AND 5);

-- A locked slot cannot hold a container. Installing into a slot nobody bought
-- would be five free slots wearing one price tag.
ALTER TABLE "CharacterContainerSlot"
  ADD CONSTRAINT "CharacterContainerSlot_locked_is_empty_check"
  CHECK ("containerInstanceId" IS NULL OR "unlockedAt" IS NOT NULL);

-- ───────────────────────────────────────────────────────────────────────────
-- The Stash is the one place a quantity may exceed a stack
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "StashEntry"
  ADD CONSTRAINT "StashEntry_quantity_check"
  CHECK ("quantity" >= 1);

-- ───────────────────────────────────────────────────────────────────────────
-- The application role owns items, and may not invent accounts or characters
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "ItemInstance"           TO "globalidle_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON "CharacterContainerSlot" TO "globalidle_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON "StashEntry"             TO "globalidle_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON "CharacterLootPolicy"    TO "globalidle_app";
