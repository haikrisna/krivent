-- Additive only. No historical event backfill. Actor IDs intentionally survive account deletion.
CREATE TABLE "audit_logs" (
 "id" UUID NOT NULL, "actor_id" UUID NOT NULL,
 "action" VARCHAR(80) NOT NULL, "resource_type" VARCHAR(40) NOT NULL,
 "resource_id" UUID NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "metadata" JSONB NOT NULL, "request_id" UUID,
 CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at", "id");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "sales_status_fulfilled_at_id_idx" ON "sales"("status", "fulfilled_at", "id");
CREATE INDEX "sales_created_by_id_fulfilled_at_idx" ON "sales"("created_by_id", "fulfilled_at");
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Audit logs are append-only';
END;
$$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
 FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
