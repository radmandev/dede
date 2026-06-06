-- 009_profiles_org_denorm.sql
-- Root fix for infinite recursion in organization_members policies.
--
-- Problem: any policy on organization_members that called get_current_org_ids()
-- (which queries organization_members) created a cycle the planner detected as
-- infinite recursion, even through SECURITY DEFINER PL/pgSQL.
--
-- Solution: denormalize organization_id + org_role onto profiles.
-- All RLS helpers now read ONLY from profiles (no organization_members).
-- organization_members is kept as a team-roster table; policies on it use
-- get_current_org_id() which queries profiles only — no cycle possible.

-- ── 1. Extend profiles ───────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_role TEXT NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS idx_profiles_org ON profiles(organization_id);

-- ── 2. Non-recursive helper functions ────────────────────────────────────────
-- PL/pgSQL + SECURITY DEFINER: not inlined by planner; runs as postgres
-- (superuser) so inner queries bypass RLS entirely.

CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE v UUID;
BEGIN
  SELECT organization_id INTO v FROM profiles WHERE auth_uid = auth.uid()::uuid LIMIT 1;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION get_current_org_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE v TEXT;
BEGIN
  SELECT org_role INTO v FROM profiles WHERE auth_uid = auth.uid()::uuid LIMIT 1;
  RETURN v;
END;
$$;

-- Replace get_current_org_ids() — now queries profiles only, no org_members
CREATE OR REPLACE FUNCTION get_current_org_ids()
RETURNS TABLE(organization_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT p.organization_id, p.org_role
    FROM profiles p
    WHERE p.auth_uid = auth.uid()::uuid
      AND p.organization_id IS NOT NULL;
END;
$$;

-- ── 3. profiles RLS: colleagues via org field (no organization_members ref) ──

DROP POLICY IF EXISTS profiles_select_org_colleagues ON profiles;
CREATE POLICY profiles_select_org_colleagues ON profiles FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND organization_id = get_current_org_id()
  );

-- ── 4. organization_members RLS: use get_current_org_id() only ───────────────

DROP POLICY IF EXISTS org_members_select ON organization_members;
CREATE POLICY org_members_select ON organization_members FOR SELECT
  USING (organization_id = get_current_org_id());

DROP POLICY IF EXISTS org_members_insert ON organization_members;
CREATE POLICY org_members_insert ON organization_members FOR INSERT
  WITH CHECK (
    -- Existing admin adds someone to their org
    (organization_id = get_current_org_id() AND get_current_org_role() = 'admin')
    -- Org creator bootstraps themselves as first admin
    OR (
      profile_id IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
      AND organization_id IN (
        SELECT o.id FROM organizations o
        WHERE o.created_by IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
      )
    )
  );

DROP POLICY IF EXISTS org_members_update ON organization_members;
CREATE POLICY org_members_update ON organization_members FOR UPDATE
  USING (organization_id = get_current_org_id() AND get_current_org_role() = 'admin');

DROP POLICY IF EXISTS org_members_delete ON organization_members;
CREATE POLICY org_members_delete ON organization_members FOR DELETE
  USING (
    profile_id IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
    OR (organization_id = get_current_org_id() AND get_current_org_role() = 'admin')
  );

-- ── 5. organizations: simplify to use scalar helpers ─────────────────────────

DROP POLICY IF EXISTS org_update ON organizations;
CREATE POLICY org_update ON organizations FOR UPDATE
  USING (id = get_current_org_id() AND get_current_org_role() = 'admin');

-- ── 6. invitations: same ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS invitations_select ON invitations;
CREATE POLICY invitations_select ON invitations FOR SELECT
  USING (organization_id = get_current_org_id());

DROP POLICY IF EXISTS invitations_insert ON invitations;
CREATE POLICY invitations_insert ON invitations FOR INSERT
  WITH CHECK (organization_id = get_current_org_id() AND get_current_org_role() = 'admin');

DROP POLICY IF EXISTS invitations_update ON invitations;
CREATE POLICY invitations_update ON invitations FOR UPDATE
  USING (organization_id = get_current_org_id() AND get_current_org_role() = 'admin');

DROP POLICY IF EXISTS invitations_delete ON invitations;
CREATE POLICY invitations_delete ON invitations FOR DELETE
  USING (organization_id = get_current_org_id() AND get_current_org_role() = 'admin');
