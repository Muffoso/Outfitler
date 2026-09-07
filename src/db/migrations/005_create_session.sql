-- Session store table for connect-pg-simple (used to hold OAuth handshake
-- state/nonce). Mirrors the library's table.sql, minus the removed
-- WITH (OIDS=FALSE) clause, and made idempotent so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL,
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'session_pkey' AND conrelid = 'public.session'::regclass
  ) THEN
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO app_user;
