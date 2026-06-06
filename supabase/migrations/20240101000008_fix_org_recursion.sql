-- 008_fix_org_recursion.sql
-- PostgreSQL inlines LANGUAGE sql functions when planning RLS policies,
-- so get_current_org_ids() → organization_members → policy → function → ... = infinite recursion.
-- PL/pgSQL functions are opaque to the planner (never inlined), so PostgreSQL
-- does not follow their body when checking for policy cycles.
-- At runtime, SECURITY DEFINER (owner = postgres/superuser) bypasses RLS inside the function.

CREATE OR REPLACE FUNCTION get_current_org_ids()
RETURNS TABLE(organization_id UUID, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT om.organization_id, om.role
    FROM organization_members om
    JOIN profiles p ON p.id = om.profile_id
    WHERE p.auth_uid = auth.uid()::uuid;
END;
$$;
