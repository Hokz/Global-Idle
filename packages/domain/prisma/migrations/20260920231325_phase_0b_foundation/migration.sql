-- CreateEnum
CREATE TYPE "Vocation" AS ENUM ('KNIGHT', 'PALADIN', 'SORCERER', 'DRUID', 'MONK');

-- CreateEnum
CREATE TYPE "ActivityFamily" AS ENUM ('SESSION_BOUND', 'WALL_CLOCK');

-- CreateEnum
CREATE TYPE "SessionBoundState" AS ENUM ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED', 'ACTIVITY_ENDED');

-- CreateEnum
CREATE TYPE "SkillTrainingStatus" AS ENUM ('ACCRUING', 'ENDED', 'EXHAUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntitlementKind" AS ENUM ('PREMIUM');

-- CreateEnum
CREATE TYPE "StaminaMode" AS ENUM ('CONSUMING', 'NEUTRAL', 'RECOVERING');

-- CreateEnum
CREATE TYPE "CurrencyKind" AS ENUM ('GOLD', 'PREMIUM');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "rosterCapacity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "EntitlementKind" NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementAudit" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "transition" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "EntitlementAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vocation" "Vocation" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterStamina" (
    "characterId" TEXT NOT NULL,
    "remainingMs" INTEGER NOT NULL,
    "mode" "StaminaMode" NOT NULL,
    "modeSince" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterStamina_pkey" PRIMARY KEY ("characterId")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "activityTypeKey" TEXT NOT NULL,
    "family" "ActivityFamily" NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionBoundActivity" (
    "activityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "family" "ActivityFamily" NOT NULL,
    "state" "SessionBoundState" NOT NULL,
    "claimHolderSessionId" TEXT,
    "graceExpiresAt" TIMESTAMP(3),
    "rngSeed" TEXT NOT NULL,

    CONSTRAINT "SessionBoundActivity_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "SkillTrainingActivity" (
    "activityId" TEXT NOT NULL,
    "family" "ActivityFamily" NOT NULL,
    "traineeCharacterId" TEXT NOT NULL,
    "status" "SkillTrainingStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSettledAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SkillTrainingActivity_pkey" PRIMARY KEY ("activityId")
);

-- CreateTable
CREATE TABLE "ActivityParticipant" (
    "activityId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "family" "ActivityFamily" NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "staminaActivatedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityParticipant_pkey" PRIMARY KEY ("activityId","characterId")
);

-- CreateTable
CREATE TABLE "OccupancyClaim" (
    "characterId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OccupancyClaim_pkey" PRIMARY KEY ("characterId")
);

-- CreateTable
CREATE TABLE "ActiveUseTimer" (
    "id" TEXT NOT NULL,
    "remainingMs" INTEGER NOT NULL,
    "qualifyingSince" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveUseTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "principalId" TEXT NOT NULL,
    "commandNamespace" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("principalId","commandNamespace","clientKey")
);

-- CreateTable
CREATE TABLE "SettlementOperation" (
    "operationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementOperation_pkey" PRIMARY KEY ("operationId")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" "CurrencyKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyBalance" (
    "accountId" TEXT NOT NULL,
    "currency" "CurrencyKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyBalance_pkey" PRIMARY KEY ("accountId","currency")
);

-- CreateTable
CREATE TABLE "ContentBundle" (
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,

    CONSTRAINT "ContentBundle_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE INDEX "AuthIdentity_accountId_idx" ON "AuthIdentity"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE INDEX "Entitlement_accountId_kind_validFrom_idx" ON "Entitlement"("accountId", "kind", "validFrom");

-- CreateIndex
CREATE INDEX "EntitlementAudit_entitlementId_occurredAt_idx" ON "EntitlementAudit"("entitlementId", "occurredAt");

-- CreateIndex
CREATE INDEX "Character_accountId_idx" ON "Character"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_accountId_vocation_key" ON "Character"("accountId", "vocation") WHERE ("retiredAt" IS NULL);

-- CreateIndex
CREATE INDEX "Activity_activityTypeKey_family_idx" ON "Activity"("activityTypeKey", "family");

-- CreateIndex
CREATE INDEX "Activity_accountId_idx" ON "Activity"("accountId");

-- CreateIndex
CREATE INDEX "Activity_contentVersion_idx" ON "Activity"("contentVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_id_family_key" ON "Activity"("id", "family");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_id_accountId_family_key" ON "Activity"("id", "accountId", "family");

-- CreateIndex
CREATE UNIQUE INDEX "SessionBoundActivity_activityId_accountId_family_key" ON "SessionBoundActivity"("activityId", "accountId", "family");

-- CreateIndex
CREATE UNIQUE INDEX "SessionBoundActivity_accountId_key" ON "SessionBoundActivity"("accountId") WHERE (state IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'));

-- CreateIndex
CREATE UNIQUE INDEX "SkillTrainingActivity_activityId_family_key" ON "SkillTrainingActivity"("activityId", "family");

-- CreateIndex
CREATE UNIQUE INDEX "SkillTrainingActivity_activityId_traineeCharacterId_key" ON "SkillTrainingActivity"("activityId", "traineeCharacterId");

-- CreateIndex
CREATE INDEX "ActivityParticipant_characterId_idx" ON "ActivityParticipant"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityParticipant_activityId_characterId_key" ON "ActivityParticipant"("activityId", "characterId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityParticipant_activityId_key" ON "ActivityParticipant"("activityId") WHERE (family = 'WALL_CLOCK');

-- CreateIndex
CREATE INDEX "OccupancyClaim_activityId_idx" ON "OccupancyClaim"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "OccupancyClaim_activityId_characterId_key" ON "OccupancyClaim"("activityId", "characterId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_currency_createdAt_idx" ON "LedgerEntry"("accountId", "currency", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_operationId_idx" ON "LedgerEntry"("operationId");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementAudit" ADD CONSTRAINT "EntitlementAudit_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterStamina" ADD CONSTRAINT "CharacterStamina_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contentVersion_fkey" FOREIGN KEY ("contentVersion") REFERENCES "ContentBundle"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionBoundActivity" ADD CONSTRAINT "SessionBoundActivity_activityId_accountId_family_fkey" FOREIGN KEY ("activityId", "accountId", "family") REFERENCES "Activity"("id", "accountId", "family") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTrainingActivity" ADD CONSTRAINT "SkillTrainingActivity_activityId_family_fkey" FOREIGN KEY ("activityId", "family") REFERENCES "Activity"("id", "family") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillTrainingActivity" ADD CONSTRAINT "SkillTrainingActivity_activityId_traineeCharacterId_fkey" FOREIGN KEY ("activityId", "traineeCharacterId") REFERENCES "ActivityParticipant"("activityId", "characterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityParticipant" ADD CONSTRAINT "ActivityParticipant_activityId_family_fkey" FOREIGN KEY ("activityId", "family") REFERENCES "Activity"("id", "family") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityParticipant" ADD CONSTRAINT "ActivityParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccupancyClaim" ADD CONSTRAINT "OccupancyClaim_activityId_characterId_fkey" FOREIGN KEY ("activityId", "characterId") REFERENCES "ActivityParticipant"("activityId", "characterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyBalance" ADD CONSTRAINT "CurrencyBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
