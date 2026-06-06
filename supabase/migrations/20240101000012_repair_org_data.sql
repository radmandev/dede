-- 012_repair_org_data.sql
-- Comprehensive repair: re-link all conversations/bots to the correct org.
-- Safe to run multiple times (all statements are idempotent).

-- ── 1. Fix conversations whose bot row now has an org ────────────────────────
-- e.g. bot was migrated to org but the conversation still has null org_id
UPDATE conversations c
SET
  organization_id      = b.organization_id,
  owner_id             = b.owner_id,
  sendpulse_account_id = b.sendpulse_account_id
FROM sendpulse_bots b
WHERE c.sendpulse_bot_id     = b.id
  AND b.organization_id      IS NOT NULL
  AND (c.organization_id     IS NULL OR c.organization_id != b.organization_id);

-- ── 2. Fix conversations linked to an org-aware account (fallback) ───────────
UPDATE conversations c
SET organization_id = a.organization_id, owner_id = a.owner_id
FROM sendpulse_accounts a
WHERE c.sendpulse_account_id = a.id
  AND a.organization_id      IS NOT NULL
  AND c.organization_id      IS NULL;

-- ── 3. Re-link conversations that still point at a null-org duplicate bot ────
-- (duplicates from the pre-org sync: same bot_id, one row per account)
UPDATE conversations c
SET
  organization_id      = a.organization_id,
  owner_id             = a.owner_id,
  sendpulse_bot_id     = new_bot.id,
  sendpulse_account_id = a.id
FROM sendpulse_bots old_bot
JOIN sendpulse_bots new_bot
  ON  new_bot.bot_id          = old_bot.bot_id
  AND new_bot.channel         = old_bot.channel
  AND new_bot.organization_id IS NOT NULL
JOIN sendpulse_accounts a ON a.id = new_bot.sendpulse_account_id
WHERE c.sendpulse_bot_id = old_bot.id
  AND old_bot.organization_id IS NULL;

-- ── 4. Delete stale null-org bot rows that have org-aware duplicates ─────────
DELETE FROM sendpulse_bots
WHERE organization_id IS NULL
  AND bot_id IN (
    SELECT DISTINCT bot_id FROM sendpulse_bots WHERE organization_id IS NOT NULL
  );

-- ── 5. Ensure webhook_logs has no RLS so service-key writes always succeed ───
ALTER TABLE IF EXISTS webhook_logs DISABLE ROW LEVEL SECURITY;
