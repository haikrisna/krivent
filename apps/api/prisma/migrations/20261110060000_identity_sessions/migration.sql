-- Fail safely before any DDL if legacy addresses collide after normalization.
-- Resolve the reported collisions explicitly; never silently merge accounts.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "users" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email normalization collision: review users grouped by lower(btrim(email)) before retrying migration';
  END IF;
END $$;

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALES_STAFF', 'WAREHOUSE_STAFF');
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'SALES_STAFF';
-- Keeps legacy display email intact while protecting normalized identities at DB level.
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower(btrim("email")));

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "auth_sessions_expiry" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE TABLE "refresh_tokens" (
  "hash" CHAR(64) NOT NULL,
  "session_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("hash"),
  CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refresh_tokens_expiry" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
CREATE TABLE "admin_bootstrap" (
  "id" VARCHAR(32) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_bootstrap_pkey" PRIMARY KEY ("id")
);
