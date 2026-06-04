-- 002_indexes_and_rls.sql
-- Indexes and Row-Level Security (RLS) example policies

-- Indexes
create index if not exists idx_conversations_sendpulse_conv on conversations (sendpulse_conversation_id);
create index if not exists idx_messages_conversation_sent on messages (conversation_id, sent_at);
create index if not exists idx_messages_created_at on messages (created_at);
create index if not exists idx_attachments_path on attachments (storage_path);
create index if not exists idx_sendpulse_accounts_owner on sendpulse_accounts (owner_id);
create index if not exists idx_bitrix24_accounts_owner on bitrix24_accounts (owner_id);
create index if not exists idx_bitrix24_open_channels_owner on bitrix24_open_channels (owner_id);
create index if not exists idx_sendpulse_bots_owner on sendpulse_bots (owner_id);
create index if not exists idx_templates_owner on templates (owner_id);
create index if not exists idx_bitrix24_open_channels_account on bitrix24_open_channels (bitrix24_account_id, sendpulse_account_id);
create index if not exists idx_bitrix24_open_channels_line_id on bitrix24_open_channels (bitrix24_line_id);

-- Enable RLS and example policies. IMPORTANT: review and tighten policies for your app.
alter table if exists profiles enable row level security;
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select using (auth.uid()::uuid = auth_uid);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid()::uuid = auth_uid) with check (auth.uid()::uuid = auth_uid);

alter table if exists conversations enable row level security;
-- allow owner to select/insert/update via profile ownership
drop policy if exists conversations_owner_access on conversations;
create policy conversations_owner_access on conversations
  for all using (
    exists (
      select 1 from profiles p
      where p.id = owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists messages enable row level security;
drop policy if exists messages_conversation_participant on messages;
create policy messages_conversation_participant on messages
  for all using (
    exists (
      select 1 from conversations c
      join profiles p on p.id = c.owner_id
      where c.id = messages.conversation_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from conversations c
      join profiles p on p.id = c.owner_id
      where c.id = messages.conversation_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists sendpulse_accounts enable row level security;
drop policy if exists sendpulse_accounts_owner_access on sendpulse_accounts;
create policy sendpulse_accounts_owner_access on sendpulse_accounts
  for all using (
    exists (
      select 1 from profiles p
      where p.id = sendpulse_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = sendpulse_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists bitrix24_accounts enable row level security;
drop policy if exists bitrix24_accounts_owner_access on bitrix24_accounts;
create policy bitrix24_accounts_owner_access on bitrix24_accounts
  for all using (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_accounts.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists bitrix24_open_channels enable row level security;
drop policy if exists bitrix24_open_channels_owner_access on bitrix24_open_channels;
create policy bitrix24_open_channels_owner_access on bitrix24_open_channels
  for all using (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_open_channels.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = bitrix24_open_channels.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists sendpulse_bots enable row level security;
drop policy if exists sendpulse_bots_owner_access on sendpulse_bots;
create policy sendpulse_bots_owner_access on sendpulse_bots
  for all using (
    exists (
      select 1 from profiles p
      where p.id = sendpulse_bots.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = sendpulse_bots.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists templates enable row level security;
drop policy if exists templates_owner_access on templates;
create policy templates_owner_access on templates
  for all using (
    exists (
      select 1 from profiles p
      where p.id = templates.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = templates.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

alter table if exists attachments enable row level security;
drop policy if exists attachments_owner_access on attachments;
create policy attachments_owner_access on attachments
  for all using (
    exists (
      select 1 from profiles p
      where p.id = attachments.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  ) with check (
    exists (
      select 1 from profiles p
      where p.id = attachments.owner_id
        and p.auth_uid = auth.uid()::uuid
    )
  );

-- Note: These policies assume `profiles.auth_uid` stores the Supabase user ID.
-- The owner mapping uses the conversation.owner_id profile ID, not auth.uid() directly.
