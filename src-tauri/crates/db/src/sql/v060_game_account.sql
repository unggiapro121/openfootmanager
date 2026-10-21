-- The coach account the career belongs to; NULL for a career with none (made by
-- an MCP agent, or before accounts existed), so existing rows need no backfill.
ALTER TABLE game_meta ADD COLUMN account_id TEXT;
