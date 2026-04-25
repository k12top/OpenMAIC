-- Add 'sso' value to the share_mode enum
-- PostgreSQL requires ALTER TYPE ... ADD VALUE which cannot run inside a transaction block.
-- If setting up a fresh database, run drizzle-kit push which handles this automatically.

ALTER TYPE "share_mode" ADD VALUE IF NOT EXISTS 'sso';
