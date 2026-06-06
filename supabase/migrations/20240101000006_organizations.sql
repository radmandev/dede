-- 006_organizations.sql
-- Multi-tenant architecture: organizations, members, invitations

-- ============================================================
-- New tables
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, profile_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  token           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Add organization_id to existing tables
-- ============================================================

ALTER TABLE sendpulse_accounts   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE bitrix24_accounts    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE bitrix24_open_channels ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE conversations        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE sendpulse_bots       ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE templates            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE attachments          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_org_members_org     ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_profile ON organization_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token   ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org     ON invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_sp_accounts_org     ON sendpulse_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_b24_accounts_org    ON bitrix24_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_boc_org             ON bitrix24_open_channels(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_org   ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_sp_bots_org         ON sendpulse_bots(organization_id);

-- ============================================================
-- Helper: get org IDs + roles for current user
-- ============================================================

CREATE OR REPLACE FUNCTION get_current_org_ids()
RETURNS TABLE(organization_id UUID, role TEXT) AS $$
  SELECT om.organization_id, om.role
  FROM organization_members om
  JOIN profiles p ON p.id = om.profile_id
  WHERE p.auth_uid = auth.uid()::uuid
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- RLS: new tables
-- ============================================================

ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations         ENABLE ROW LEVEL SECURITY;

-- organizations
DROP POLICY IF EXISTS org_select ON organizations;
CREATE POLICY org_select ON organizations FOR SELECT
  USING (id IN (SELECT go.organization_id FROM get_current_org_ids() go));

DROP POLICY IF EXISTS org_insert ON organizations;
CREATE POLICY org_insert ON organizations FOR INSERT
  WITH CHECK (
    created_by IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
  );

DROP POLICY IF EXISTS org_update ON organizations;
CREATE POLICY org_update ON organizations FOR UPDATE
  USING (id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'));

-- organization_members
DROP POLICY IF EXISTS org_members_select ON organization_members;
CREATE POLICY org_members_select ON organization_members FOR SELECT
  USING (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go));

DROP POLICY IF EXISTS org_members_insert ON organization_members;
CREATE POLICY org_members_insert ON organization_members FOR INSERT
  WITH CHECK (
    -- Admin adds anyone to their org
    organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin')
    -- Or founder inserts themselves into an org they just created
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
  USING (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'));

DROP POLICY IF EXISTS org_members_delete ON organization_members;
CREATE POLICY org_members_delete ON organization_members FOR DELETE
  USING (
    organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin')
    OR profile_id IN (SELECT p.id FROM profiles p WHERE p.auth_uid = auth.uid()::uuid)
  );

-- invitations
DROP POLICY IF EXISTS invitations_select ON invitations;
CREATE POLICY invitations_select ON invitations FOR SELECT
  USING (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go));

DROP POLICY IF EXISTS invitations_insert ON invitations;
CREATE POLICY invitations_insert ON invitations FOR INSERT
  WITH CHECK (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'));

DROP POLICY IF EXISTS invitations_update ON invitations;
CREATE POLICY invitations_update ON invitations FOR UPDATE
  USING (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'));

DROP POLICY IF EXISTS invitations_delete ON invitations;
CREATE POLICY invitations_delete ON invitations FOR DELETE
  USING (organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'));

-- ============================================================
-- Update profiles RLS: org members can see their colleagues
-- ============================================================

DROP POLICY IF EXISTS profiles_select_org_colleagues ON profiles;
CREATE POLICY profiles_select_org_colleagues ON profiles FOR SELECT
  USING (
    id IN (
      SELECT om.profile_id FROM organization_members om
      WHERE om.organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go)
    )
  );

-- ============================================================
-- Update RLS on existing tables to use org membership
-- (dual-mode: org-based OR legacy owner_id-based)
-- ============================================================

-- sendpulse_accounts
DROP POLICY IF EXISTS sendpulse_accounts_owner_access ON sendpulse_accounts;
DROP POLICY IF EXISTS sendpulse_accounts_access       ON sendpulse_accounts;
CREATE POLICY sendpulse_accounts_access ON sendpulse_accounts FOR ALL
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = sendpulse_accounts.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = sendpulse_accounts.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  );

-- sendpulse_bots
DROP POLICY IF EXISTS sendpulse_bots_owner_access ON sendpulse_bots;
DROP POLICY IF EXISTS sendpulse_bots_access       ON sendpulse_bots;
CREATE POLICY sendpulse_bots_access ON sendpulse_bots FOR ALL
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = sendpulse_bots.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = sendpulse_bots.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  );

-- bitrix24_accounts (keep unclaimed / org-null visibility)
DROP POLICY IF EXISTS bitrix24_accounts_select ON bitrix24_accounts;
DROP POLICY IF EXISTS bitrix24_accounts_insert ON bitrix24_accounts;
DROP POLICY IF EXISTS bitrix24_accounts_update ON bitrix24_accounts;
DROP POLICY IF EXISTS bitrix24_accounts_delete ON bitrix24_accounts;

CREATE POLICY bitrix24_accounts_select ON bitrix24_accounts FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
      OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_accounts.owner_id AND p.auth_uid = auth.uid()::uuid))
      OR (organization_id IS NULL AND owner_id IS NULL)
    )
  );

CREATE POLICY bitrix24_accounts_insert ON bitrix24_accounts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY bitrix24_accounts_update ON bitrix24_accounts FOR UPDATE
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_accounts.owner_id AND p.auth_uid = auth.uid()::uuid))
    OR (organization_id IS NULL AND owner_id IS NULL AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_accounts.owner_id AND p.auth_uid = auth.uid()::uuid))
  );

CREATE POLICY bitrix24_accounts_delete ON bitrix24_accounts FOR DELETE
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_accounts.owner_id AND p.auth_uid = auth.uid()::uuid))
  );

-- bitrix24_open_channels
DROP POLICY IF EXISTS bitrix24_open_channels_select ON bitrix24_open_channels;
DROP POLICY IF EXISTS bitrix24_open_channels_insert ON bitrix24_open_channels;
DROP POLICY IF EXISTS bitrix24_open_channels_update ON bitrix24_open_channels;
DROP POLICY IF EXISTS bitrix24_open_channels_delete ON bitrix24_open_channels;

CREATE POLICY bitrix24_open_channels_select ON bitrix24_open_channels FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
      OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_open_channels.owner_id AND p.auth_uid = auth.uid()::uuid))
      OR (organization_id IS NULL AND owner_id IS NULL)
    )
  );

CREATE POLICY bitrix24_open_channels_insert ON bitrix24_open_channels FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY bitrix24_open_channels_update ON bitrix24_open_channels FOR UPDATE
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_open_channels.owner_id AND p.auth_uid = auth.uid()::uuid))
    OR (organization_id IS NULL AND owner_id IS NULL AND auth.uid() IS NOT NULL)
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_open_channels.owner_id AND p.auth_uid = auth.uid()::uuid))
  );

CREATE POLICY bitrix24_open_channels_delete ON bitrix24_open_channels FOR DELETE
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go WHERE go.role = 'admin'))
    OR (owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = bitrix24_open_channels.owner_id AND p.auth_uid = auth.uid()::uuid))
  );

-- conversations
DROP POLICY IF EXISTS conversations_owner_access ON conversations;
DROP POLICY IF EXISTS conversations_access       ON conversations;
CREATE POLICY conversations_access ON conversations FOR ALL
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = conversations.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = conversations.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  );

-- messages (access via parent conversation's org)
DROP POLICY IF EXISTS messages_conversation_participant ON messages;
DROP POLICY IF EXISTS messages_access                   ON messages;
CREATE POLICY messages_access ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND (
        (c.organization_id IS NOT NULL AND c.organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
        OR (c.organization_id IS NULL AND EXISTS (
          SELECT 1 FROM profiles p WHERE p.id = c.owner_id AND p.auth_uid = auth.uid()::uuid
        ))
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND (
        (c.organization_id IS NOT NULL AND c.organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
        OR (c.organization_id IS NULL AND EXISTS (
          SELECT 1 FROM profiles p WHERE p.id = c.owner_id AND p.auth_uid = auth.uid()::uuid
        ))
      )
    )
  );

-- templates
DROP POLICY IF EXISTS templates_owner_access ON templates;
DROP POLICY IF EXISTS templates_access       ON templates;
CREATE POLICY templates_access ON templates FOR ALL
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = templates.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = templates.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  );

-- attachments
DROP POLICY IF EXISTS attachments_owner_access ON attachments;
DROP POLICY IF EXISTS attachments_access       ON attachments;
CREATE POLICY attachments_access ON attachments FOR ALL
  USING (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = attachments.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  )
  WITH CHECK (
    (organization_id IS NOT NULL AND organization_id IN (SELECT go.organization_id FROM get_current_org_ids() go))
    OR (organization_id IS NULL AND owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = attachments.owner_id AND p.auth_uid = auth.uid()::uuid
    ))
  );
