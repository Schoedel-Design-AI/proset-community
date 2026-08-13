ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "force_password_change" integer NOT NULL DEFAULT 0;

-- Note: the hosted deployment forced password resets for a specific user list
-- here. That list is intentionally omitted from the public Community Edition.
