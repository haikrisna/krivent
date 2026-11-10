-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "contact_name" VARCHAR(120),
ADD COLUMN     "dedup_key" VARCHAR(120),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lead_id" UUID,
ADD COLUMN     "normalized_email" VARCHAR(254),
ADD COLUMN     "owner_id" UUID;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "source" VARCHAR(80) NOT NULL,
    "owner_id" UUID NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "lost_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "customer_id" UUID,
    "actor_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "note" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "customer_id" UUID,
    "assignee_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_owner_id_is_active_stage_idx" ON "leads"("owner_id", "is_active", "stage");

-- CreateIndex
CREATE INDEX "leads_source_idx" ON "leads"("source");

-- CreateIndex
CREATE INDEX "leads_created_at_id_idx" ON "leads"("created_at", "id");

-- CreateIndex
CREATE INDEX "crm_activities_lead_id_occurred_at_id_idx" ON "crm_activities"("lead_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "crm_activities_customer_id_occurred_at_id_idx" ON "crm_activities"("customer_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "follow_ups_assignee_id_status_due_at_idx" ON "follow_ups"("assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_lead_id_due_at_idx" ON "follow_ups"("lead_id", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_customer_id_due_at_idx" ON "follow_ups"("customer_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_lead_id_key" ON "customers"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_dedup_key_key" ON "customers"("dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "customers_normalized_email_key" ON "customers"("normalized_email");

-- CreateIndex
CREATE INDEX "customers_owner_id_is_active_idx" ON "customers"("owner_id", "is_active");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL invariants not expressible in Prisma schema; apply to new tables only.
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activity_one_target" CHECK ((lead_id IS NULL) <> (customer_id IS NULL));
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_up_one_target" CHECK ((lead_id IS NULL) <> (customer_id IS NULL));
ALTER TABLE "leads" ADD CONSTRAINT "lost_requires_reason" CHECK (stage <> 'LOST' OR length(trim(lost_reason)) > 0 AND lost_reason IS NOT NULL);
