-- 014_super_admin_impersonate_policies.sql
-- Grants super admins (profiles.role = 'admin') full read/write access across
-- all org-scoped tables so they can impersonate any organization from the UI.
-- is_super_admin() is defined in migration 013.

-- ── conversations ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_conversations ON conversations;
CREATE POLICY super_admin_conversations ON conversations FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── messages ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_messages ON messages;
CREATE POLICY super_admin_messages ON messages FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── sendpulse_accounts (add UPDATE — SELECT/DELETE already in 013) ─────────
DROP POLICY IF EXISTS super_admin_sendpulse_update ON sendpulse_accounts;
CREATE POLICY super_admin_sendpulse_update ON sendpulse_accounts FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── bitrix24_accounts (add UPDATE) ────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_bitrix24_update ON bitrix24_accounts;
CREATE POLICY super_admin_bitrix24_update ON bitrix24_accounts FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── bitrix24_open_channels (add UPDATE) ───────────────────────────────────
DROP POLICY IF EXISTS super_admin_channels_update ON bitrix24_open_channels;
CREATE POLICY super_admin_channels_update ON bitrix24_open_channels FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── sendpulse_bots ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_sendpulse_bots ON sendpulse_bots;
CREATE POLICY super_admin_sendpulse_bots ON sendpulse_bots FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── templates ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_templates ON templates;
CREATE POLICY super_admin_templates ON templates FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── global_config ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_global_config ON global_config;
CREATE POLICY super_admin_global_config ON global_config FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ── app_config ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_app_config ON app_config;
CREATE POLICY super_admin_app_config ON app_config FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());
