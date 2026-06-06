-- 007_fix_org_rls.sql
-- Fix chicken-and-egg RLS issues in org creation:
--   1. org INSERT WITH CHECK was querying profiles under RLS — simplify to auth-only
--   2. org SELECT didn't cover the creator before they became a member — add OR created_by
--   3. org_members INSERT couldn't verify org.created_by because SELECT was blocked — fixed by #2

-- organizations INSERT: any authenticated user can create an org
DROP POLICY IF EXISTS org_insert ON organizations;
CREATE POLICY org_insert ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- organizations SELECT: members OR the org creator
DROP POLICY IF EXISTS org_select ON organizations;
CREATE POLICY org_select ON organizations FOR SELECT
  USING (
    id IN (SELECT go.organization_id FROM get_current_org_ids() go)
    OR created_by IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
  );

-- org_members INSERT: admin adds anyone, OR creator adds themselves as first admin
DROP POLICY IF EXISTS org_members_insert ON organization_members;
CREATE POLICY org_members_insert ON organization_members FOR INSERT
  WITH CHECK (
    -- Existing admin adds a new member to their org
    organization_id IN (
      SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'
    )
    -- Org creator inserts themselves (onboarding — org SELECT now allows this)
    OR (
      profile_id IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
      AND organization_id IN (
        SELECT o.id FROM organizations o
        WHERE o.created_by IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
      )
    )
  );
