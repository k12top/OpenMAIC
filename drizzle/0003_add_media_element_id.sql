-- Add element_id column + composite index to classroom_media so async MinIO
-- uploads can be backfilled into scene content when the client persists before
-- the upload completes.

ALTER TABLE "classroom_media" ADD COLUMN IF NOT EXISTS "element_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_classroom_element" ON "classroom_media" USING btree ("classroom_id","element_id");
