ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_sync_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_sync_grace_period_end TIMESTAMP;
