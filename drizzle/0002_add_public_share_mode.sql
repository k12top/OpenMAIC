-- Add 'public' value to the share_mode enum
-- PostgreSQL requires ALTER TYPE ... ADD VALUE which cannot run inside a transaction block.
-- drizzle-kit generate/push handles this automatically, but if you apply manually:
--   psql $DATABASE_URL -c "ALTER TYPE share_mode ADD VALUE IF NOT EXISTS 'public';"

ALTER TYPE "share_mode" ADD VALUE IF NOT EXISTS 'public';
