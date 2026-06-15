-- 013_super_admin_policies.sql
-- Allow users with profiles.role = 'admin' (super admins) to read and manage
-- all organizations, members, and connections across every org.

-- ── Helper ─────────────────────────────────────────────────────────────────
-- Returns true when the calling user is a super admin (global role).
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_uid = auth.uid()::uuid
      AND role = 'admin'
  );
END;
$$;

-- ── organizations ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_orgs_select ON organizations;
CREATE POLICY super_admin_orgs_select ON organizations FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_orgs_delete ON organizations;
CREATE POLICY super_admin_orgs_delete ON organizations FOR DELETE
  USING (is_super_admin());

-- ── profiles ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_profiles_select ON profiles;
CREATE POLICY super_admin_profiles_select ON profiles FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_profiles_update ON profiles;
CREATE POLICY super_admin_profiles_update ON profiles FOR UPDATE
  USING (is_super_admin());

-- ── organization_members ───────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_org_members_select ON organization_members;
CREATE POLICY super_admin_org_members_select ON organization_members FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_org_members_delete ON organization_members;
CREATE POLICY super_admin_org_members_delete ON organization_members FOR DELETE
  USING (is_super_admin());

-- ── sendpulse_accounts ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_sendpulse_select ON sendpulse_accounts;
CREATE POLICY super_admin_sendpulse_select ON sendpulse_accounts FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_sendpulse_delete ON sendpulse_accounts;
CREATE POLICY super_admin_sendpulse_delete ON sendpulse_accounts FOR DELETE
  USING (is_super_admin());

-- ── bitrix24_accounts ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_bitrix24_select ON bitrix24_accounts;
CREATE POLICY super_admin_bitrix24_select ON bitrix24_accounts FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_bitrix24_delete ON bitrix24_accounts;
CREATE POLICY super_admin_bitrix24_delete ON bitrix24_accounts FOR DELETE
  USING (is_super_admin());

-- ── bitrix24_open_channels ─────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_channels_select ON bitrix24_open_channels;
CREATE POLICY super_admin_channels_select ON bitrix24_open_channels FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS super_admin_channels_delete ON bitrix24_open_channels;
CREATE POLICY super_admin_channels_delete ON bitrix24_open_channels FOR DELETE
  USING (is_super_admin());

-- ── invitations ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS super_admin_invitations_select ON invitations;
CREATE POLICY super_admin_invitations_select ON invitations FOR SELECT
  USING (is_super_admin());
