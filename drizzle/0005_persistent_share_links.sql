-- Collapse historical (classroom_id, user_id) duplicates into the earliest
-- share row, then enforce a unique constraint so that subsequent /api/share
-- POST calls upsert the existing token instead of minting a new one.
--
-- Step 1: delete duplicate shares (keep the row with the smallest created_at,
-- ties broken by the smallest id). This is wrapped in a CTE so it is safe to
-- re-run; if no duplicates exist it deletes nothing.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY classroom_id, user_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM shares
)
DELETE FROM shares
USING ranked
WHERE shares.id = ranked.id
  AND ranked.rn > 1;
--> statement-breakpoint

-- Step 2: enforce uniqueness so future inserts must upsert.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_share_classroom_user"
  ON "shares" USING btree ("classroom_id", "user_id");
