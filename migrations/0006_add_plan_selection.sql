ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_seen_plan_selection" integer NOT NULL DEFAULT 0;
