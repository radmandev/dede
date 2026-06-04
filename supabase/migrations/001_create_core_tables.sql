-- 001_create_core_tables.sql
-- Core tables for migrating base44 entities to Supabase Postgres

create extension if not exists pgcrypto;

-- Profiles (user metadata linked to Supabase Auth users)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid references auth.users(id) on delete cascade,
  role text check (role in ('admin','user')) default 'user',
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- SendPulse Accounts
create table if not exists sendpulse_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  name text,
  client_id text,
  client_secret text,
  access_token text,
  token_expires_at timestamptz,
  status text default 'not_configured',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- SendPulse Bots
create table if not exists sendpulse_bots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  name text,
  sendpulse_account_id uuid references sendpulse_accounts(id) on delete cascade,
  bot_id text,
  channel text,
  webhook_active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Bitrix24 Accounts
create table if not exists bitrix24_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  name text,
  domain text,
  member_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  app_client_id text,
  app_client_secret text,
  status text default 'not_configured',
  _last_poll_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Conversations
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) ,
  open_channel_id text,
  sendpulse_account_id uuid references sendpulse_accounts(id),
  bitrix24_account_id uuid references bitrix24_accounts(id),
  sendpulse_conversation_id text,
  sendpulse_bot_id uuid references sendpulse_bots(id),
  sendpulse_contact_id text,
  contact_name text,
  contact_phone text,
  channel text,
  status text default 'open',
  unread_count integer default 0,
  last_message_text text,
  last_message_at timestamptz,
  bitrix24_chat_id bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id),
  sendpulse_message_id text,
  sender_name text,
  message_text text,
  message_type text default 'text',
  media_url text,
  media_name text,
  direction text,
  channel text,
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- Bitrix24 Open Channels
create table if not exists bitrix24_open_channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  name text,
  bitrix24_account_id uuid references bitrix24_accounts(id) on delete cascade,
  sendpulse_account_id uuid references sendpulse_accounts(id) on delete cascade,
  bitrix24_line_id text,
  bitrix24_connector_id text default 'whatsapp_sendpulse',
  sendpulse_bot_id uuid references sendpulse_bots(id) on delete set null,
  channel text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Attachments metadata (file objects are stored in Supabase Storage)
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  storage_path text,
  url text,
  filename text,
  content_type text,
  size bigint,
  uploaded_at timestamptz default now()
);

-- Templates (SendPulse templates cache)
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id),
  sendpulse_account_id uuid references sendpulse_accounts(id) on delete cascade,
  template_id text,
  name text,
  body jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- App and Global config (single-row or key/value JSONB)
create table if not exists app_config (
  id integer primary key default 1,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists global_config (
  id integer primary key default 1,
  data jsonb,
  updated_at timestamptz default now()
);

-- Webhook logs for replay/debugging
create table if not exists webhook_logs (
  id uuid primary key default gen_random_uuid(),
  provider text,
  payload jsonb,
  headers jsonb,
  received_at timestamptz default now(),
  processed boolean default false,
  processed_at timestamptz
);

-- Trigger helpers: update `updated_at` on row changes
create or replace function trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_timestamp
before update on conversations
for each row
execute procedure trigger_set_timestamp();

create trigger set_timestamp_messages
before update on messages
for each row
execute procedure trigger_set_timestamp();
