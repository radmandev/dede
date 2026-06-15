-- Table: synced Bitrix24 portal users
-- Populated by the sync-bitrix24-users edge function.
-- Permissions are managed by org admins via the Bitrix24 Users page.
-- auth_user_id is lazily set on first widget login via bitrix24-widget-auth.

CREATE TABLE IF NOT EXISTS bitrix24_portal_users (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  bitrix24_account_id  UUID        NOT NULL REFERENCES bitrix24_accounts(id) ON DELETE CASCADE,
  b24_user_id          INTEGER     NOT NULL,
  auth_user_id         UUID,       -- FK to auth.users, set on first widget login
  permission           TEXT        NOT NULL DEFAULT 'none', -- 'none' | 'active' | 'disabled'
  name                 TEXT,
  email                TEXT,
  department           TEXT,
  title                TEXT,
  photo_url            TEXT,
  is_b24_admin         BOOLEAN     DEFAULT FALSE,
  last_seen_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bitrix24_account_id, b24_user_id)
);

CREATE INDEX IF NOT EXISTS idx_b24_portal_users_org     ON bitrix24_portal_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_b24_portal_users_account ON bitrix24_portal_users(bitrix24_account_id);
CREATE INDEX IF NOT EXISTS idx_b24_portal_users_auth    ON bitrix24_portal_users(auth_user_id);

ALTER TABLE bitrix24_portal_users ENABLE ROW LEVEL SECURITY;

-- Org members can read their org's B24 users
CREATE POLICY "org_members_read_b24_portal_users"
  ON bitrix24_portal_users FOR SELECT
  USING (
    organization_id = get_current_org_id()
    OR is_super_admin()
  );

-- Org admins can insert/update/delete
CREATE POLICY "org_admins_manage_b24_portal_users"
  ON bitrix24_portal_users FOR ALL
  USING (
    (organization_id = get_current_org_id() AND get_current_org_role() = 'admin')
    OR is_super_admin()
  )
  WITH CHECK (
    (organization_id = get_current_org_id() AND get_current_org_role() = 'admin')
    OR is_super_admin()
  );
