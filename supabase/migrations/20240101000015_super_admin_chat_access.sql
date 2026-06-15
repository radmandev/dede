-- 015_super_admin_chat_access.sql
-- Tightens super admin access to conversations and messages:
-- access is granted ONLY when the request carries the
-- 'x-admin-impersonating-org' header matching the row's organization.
--
-- This means the super admin can see chats exclusively while actively
-- impersonating an org from the UI — not from any other context.

-- ── Helper: safely read the impersonation org header ──────────────────────
CREATE OR REPLACE FUNCTION get_impersonating_org_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN nullif(
    nullif(current_setting('request.headers', true), '')::json->>'x-admin-impersonating-org',
    ''
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ── conversations ──────────────────────────────────────────────────────────
-- Replace the broad super-admin policy from migration 014 with a
-- header-scoped one: super admin can only access conversations belonging
-- to the org they are currently impersonating.
DROP POLICY IF EXISTS super_admin_conversations ON conversations;
CREATE POLICY super_admin_conversations ON conversations FOR ALL
  USING (
    is_super_admin()
    AND organization_id IS NOT NULL
    AND organization_id::text = get_impersonating_org_id()
  )
  WITH CHECK (
    is_super_admin()
    AND organization_id IS NOT NULL
    AND organization_id::text = get_impersonating_org_id()
  );

-- ── messages ───────────────────────────────────────────────────────────────
-- Same restriction: accessible only when the parent conversation's org
-- matches the active impersonation header.
DROP POLICY IF EXISTS super_admin_messages ON messages;
CREATE POLICY super_admin_messages ON messages FOR ALL
  USING (
    is_super_admin()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.organization_id IS NOT NULL
        AND c.organization_id::text = get_impersonating_org_id()
    )
  )
  WITH CHECK (
    is_super_admin()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.organization_id IS NOT NULL
        AND c.organization_id::text = get_impersonating_org_id()
    )
  );
