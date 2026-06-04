-- 003_delivery_queue.sql
-- Delivery queue and error logging for SendPulse deliveries

create table if not exists delivery_queue (
  id uuid primary key default gen_random_uuid(),
  sendpulse_account_id uuid references sendpulse_accounts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  contact_id text,
  channel text,
  payload jsonb,
  attempts integer default 0,
  max_attempts integer default 5,
  next_attempt_at timestamptz default now(),
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_delivery_queue_next_attempt on delivery_queue (next_attempt_at, attempts);

create table if not exists delivery_errors (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references delivery_queue(id) on delete set null,
  sendpulse_account_id uuid references sendpulse_accounts(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,
  contact_id text,
  channel text,
  error_text text,
  response_body jsonb,
  created_at timestamptz default now()
);
