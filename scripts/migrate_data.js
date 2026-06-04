#!/usr/bin/env node
/*
  scripts/migrate_data.js
  Skeleton ETL to migrate exported base44 JSON data into Supabase.

  Usage:
    SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate_data.js path/to/export.json

  The `export.json` should be an object with arrays keyed by entity name, e.g.
  {
    "conversations": [...],
    "messages": [...],
    "sendpulse_accounts": [...]
  }

  This script is idempotent (uses upsert) and intended as a starting point. Extend mapping logic as needed.
*/

import fs from 'fs';
import path from 'path';
import process from 'process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

const argv = process.argv.slice(2);
if (argv.length < 1) {
  console.error('Usage: node scripts/migrate_data.js path/to/export.json');
  process.exit(1);
}

const exportPath = path.resolve(argv[0]);
if (!fs.existsSync(exportPath)) {
  console.error('Export file not found:', exportPath);
  process.exit(1);
}

const raw = fs.readFileSync(exportPath, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error('Failed to parse JSON:', err.message);
  process.exit(1);
}

async function upsertMany(table, rows) {
  if (!rows || rows.length === 0) return { count: 0 };
  const { data: res, error } = await supabase.from(table).upsert(rows, { onConflict: ['id'] });
  if (error) throw error;
  return { count: rows.length };
}

async function run() {
  console.log('Starting migration to', SUPABASE_URL);

  // Example mapping: if your exported files use different keys, adapt here.
  if (data.sendpulse_accounts) {
    console.log('Migrating sendpulse_accounts:', data.sendpulse_accounts.length);
    await upsertMany('sendpulse_accounts', data.sendpulse_accounts.map(r => ({
      id: r.id,
      name: r.name,
      client_id: r.client_id,
      client_secret: r.client_secret,
      access_token: r.access_token,
      token_expires_at: r.token_expires_at,
      status: r.status
    })));
  }

  if (data.sendpulse_bots) {
    console.log('Migrating sendpulse_bots:', data.sendpulse_bots.length);
    await upsertMany('sendpulse_bots', data.sendpulse_bots.map(r => ({
      id: r.id,
      name: r.name,
      sendpulse_account_id: r.sendpulse_account_id,
      bot_id: r.bot_id,
      channel: r.channel,
      webhook_active: r.webhook_active
    })));
  }

  if (data.bitrix24_accounts) {
    console.log('Migrating bitrix24_accounts:', data.bitrix24_accounts.length);
    await upsertMany('bitrix24_accounts', data.bitrix24_accounts.map(r => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      member_id: r.member_id,
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      token_expires_at: r.token_expires_at,
      app_client_id: r.app_client_id,
      app_client_secret: r.app_client_secret,
      status: r.status,
      _last_poll_at: r._last_poll_at
    })));
  }

  if (data.profiles) {
    console.log('Migrating profiles:', data.profiles.length);
    await upsertMany('profiles', data.profiles.map(r => ({
      id: r.id,
      auth_uid: r.auth_uid || r.id,
      role: r.role,
      display_name: r.display_name,
      avatar_url: r.avatar_url
    })));
  }

  if (data.conversations) {
    console.log('Migrating conversations:', data.conversations.length);
    await upsertMany('conversations', data.conversations.map(r => ({
      id: r.id,
      owner_id: r.owner_id,
      open_channel_id: r.open_channel_id,
      sendpulse_account_id: r.sendpulse_account_id,
      bitrix24_account_id: r.bitrix24_account_id,
      sendpulse_conversation_id: r.sendpulse_conversation_id,
      sendpulse_bot_id: r.sendpulse_bot_id,
      sendpulse_contact_id: r.sendpulse_contact_id,
      contact_name: r.contact_name,
      contact_phone: r.contact_phone,
      channel: r.channel,
      status: r.status,
      unread_count: r.unread_count,
      last_message_text: r.last_message_text,
      last_message_at: r.last_message_at,
      bitrix24_chat_id: r.bitrix24_chat_id,
      created_at: r.created_at,
      updated_at: r.updated_at
    })));
  }

  if (data.messages) {
    console.log('Migrating messages:', data.messages.length);
    await upsertMany('messages', data.messages.map(r => ({
      id: r.id,
      conversation_id: r.conversation_id,
      sender_id: r.sender_id,
      sendpulse_message_id: r.sendpulse_message_id,
      sender_name: r.sender_name,
      message_text: r.message_text,
      message_type: r.message_type,
      media_url: r.media_url,
      media_name: r.media_name,
      direction: r.direction,
      channel: r.channel,
      sent_at: r.sent_at,
      created_at: r.created_at
    })));
  }

  console.log('Migration finished. Verify data and run integrity checks.');
}

run().catch(err => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
