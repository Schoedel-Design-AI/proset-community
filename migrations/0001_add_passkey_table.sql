CREATE TABLE IF NOT EXISTS "passkey" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" varchar NOT NULL,
	"credential_id" text NOT NULL UNIQUE,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
	"aaguid" text,
	CONSTRAINT "passkey_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_user_id_idx" ON "passkey" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");
