-- 011_fix_duplicate_bots.sql
-- When the org was created, bots were re-synced under the new account,
-- leaving duplicate rows: same bot_id, old row has organization_id = null.
-- The webhook lookup (.eq('bot_id').limit(1)) hits the old row first,
-- creating conversations with no org/wrong owner → invisible to the user.

-- Step 1: Re-link existing conversations to the org-aware bot + account
-- (do this BEFORE deleting old bot rows so the join still works)
UPDATE conversations c
SET
  organization_id = a.organization_id,
  owner_id        = a.owner_id,
  sendpulse_bot_id     = new_bot.id,
  sendpulse_account_id = a.id
FROM sendpulse_bots old_bot
JOIN sendpulse_bots new_bot
  ON  new_bot.bot_id   = old_bot.bot_id
  AND new_bot.channel  = old_bot.channel
  AND new_bot.organization_id IS NOT NULL
JOIN sendpulse_accounts a ON a.id = new_bot.sendpulse_account_id
WHERE c.sendpulse_bot_id = old_bot.id
  AND old_bot.organization_id IS NULL;

-- Step 2: Fix any remaining null-org conversations via their account link
UPDATE conversations c
SET
  organization_id = a.organization_id,
  owner_id        = a.owner_id
FROM sendpulse_accounts a
WHERE c.sendpulse_account_id = a.id
  AND c.organization_id IS NULL
  AND a.organization_id IS NOT NULL;

-- Step 3: Delete the stale null-org bot rows
DELETE FROM sendpulse_bots
WHERE organization_id IS NULL
  AND bot_id IN (
    SELECT DISTINCT bot_id
    FROM sendpulse_bots
    WHERE organization_id IS NOT NULL
  );
