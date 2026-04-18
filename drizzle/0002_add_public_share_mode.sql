-- Add 'public' value to the share_mode enum (applied 2026-04-18)
-- PostgreSQL requires ALTER TYPE ... ADD VALUE which cannot run inside a transaction block.
-- This migration has already been applied to the remote database.
-- If setting up a fresh database, run drizzle-kit push which handles this automatically.

ALTER TYPE "share_mode" ADD VALUE IF NOT EXISTS 'public';
