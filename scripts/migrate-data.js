#!/usr/bin/env node

/**
 * Data Migration Script: Base44 → Supabase
 * 
 * This script demonstrates how to migrate data from a Base44 JSON/API
 * source into Supabase Postgres. Adapt source paths and API calls as needed.
 * 
 * Usage:
 *   node migrate-data.js [source-dir] [supabase-url] [service-key]
 * 
 * Environment:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Service role key
 *   SOURCE_DIR - Base44 export directory (default: ./base44-export)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SOURCE_DIR = process.argv[2] || process.env.SOURCE_DIR || './base44-export';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

/**
 * Load Base44 JSON entity export
 */
function loadEntityJSON(entity) {
  const file = path.join(SOURCE_DIR, `${entity}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`Warning: ${file} not found, skipping.`);
    return [];
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * Migrate profiles (from Base44 users)
 */
async function migrateProfiles() {
  console.log('Migrating profiles...');
  const users = loadEntityJSON('users');
  const profiles = users.map((u) => ({
    auth_uid: u.auth_uid || null,
    role: u.role || 'user',
    display_name: u.name || null,
    avatar_url: u.avatar_url || null,
    created_at: u.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('profiles').insert(profiles);
  if (error) {
    console.error('Error inserting profiles:', error);
    throw error;
  }
  console.log(`✓ Migrated ${profiles.length} profiles`);
}

/**
 * Migrate SendPulse accounts
 */
async function migrateSendPulseAccounts() {
  console.log('Migrating SendPulse accounts...');
  const accounts = loadEntityJSON('sendpulse_accounts');
  const rows = accounts.map((a) => ({
    owner_id: a.owner_id || null,
    name: a.name || null,
    client_id: a.client_id || null,
    client_secret: a.client_secret || null,
    access_token: a.access_token || null,
    token_expires_at: a.token_expires_at || null,
    status: a.status || 'not_configured',
    created_at: a.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('sendpulse_accounts').insert(rows);
  if (error) {
    console.error('Error inserting SendPulse accounts:', error);
    throw error;
  }
  console.log(`✓ Migrated ${rows.length} SendPulse accounts`);
}

/**
 * Migrate Bitrix24 accounts
 */
async function migrateBitrix24Accounts() {
  console.log('Migrating Bitrix24 accounts...');
  const accounts = loadEntityJSON('bitrix24_accounts');
  const rows = accounts.map((a) => ({
    owner_id: a.owner_id || null,
    name: a.name || null,
    domain: a.domain || null,
    member_id: a.member_id || null,
    access_token: a.access_token || null,
    refresh_token: a.refresh_token || null,
    token_expires_at: a.token_expires_at || null,
    app_client_id: a.app_client_id || null,
    app_client_secret: a.app_client_secret || null,
    status: a.status || 'not_configured',
    created_at: a.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('bitrix24_accounts').insert(rows);
  if (error) {
    console.error('Error inserting Bitrix24 accounts:', error);
    throw error;
  }
  console.log(`✓ Migrated ${rows.length} Bitrix24 accounts`);
}

/**
 * Migrate SendPulse bots
 */
async function migrateSendPulseBots() {
  console.log('Migrating SendPulse bots...');
  const bots = loadEntityJSON('sendpulse_bots');
  const rows = bots.map((b) => ({
    owner_id: b.owner_id || null,
    name: b.name || null,
    sendpulse_account_id: b.sendpulse_account_id || null,
    bot_id: b.bot_id || null,
    channel: b.channel || null,
    webhook_active: b.webhook_active || false,
    created_at: b.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('sendpulse_bots').insert(rows);
  if (error) {
    console.error('Error inserting SendPulse bots:', error);
    throw error;
  }
  console.log(`✓ Migrated ${rows.length} SendPulse bots`);
}

/**
 * Migrate conversations
 */
async function migrateConversations() {
  console.log('Migrating conversations...');
  const convs = loadEntityJSON('conversations');
  const rows = convs.map((c) => ({
    owner_id: c.owner_id || null,
    open_channel_id: c.open_channel_id || null,
    sendpulse_account_id: c.sendpulse_account_id || null,
    bitrix24_account_id: c.bitrix24_account_id || null,
    sendpulse_conversation_id: c.sendpulse_conversation_id || null,
    sendpulse_bot_id: c.sendpulse_bot_id || null,
    sendpulse_contact_id: c.sendpulse_contact_id || null,
    contact_name: c.contact_name || null,
    contact_phone: c.contact_phone || null,
    channel: c.channel || null,
    status: c.status || 'open',
    unread_count: c.unread_count || 0,
    last_message_text: c.last_message_text || null,
    last_message_at: c.last_message_at || null,
    bitrix24_chat_id: c.bitrix24_chat_id || null,
    created_at: c.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('conversations').insert(rows);
  if (error) {
    console.error('Error inserting conversations:', error);
    throw error;
  }
  console.log(`✓ Migrated ${rows.length} conversations`);
}

/**
 * Migrate messages
 */
async function migrateMessages() {
  console.log('Migrating messages...');
  const msgs = loadEntityJSON('messages');
  const rows = msgs.map((m) => ({
    conversation_id: m.conversation_id || null,
    sender_id: m.sender_id || null,
    sendpulse_message_id: m.sendpulse_message_id || null,
    sender_name: m.sender_name || null,
    message_text: m.message_text || null,
    message_type: m.message_type || 'text',
    media_url: m.media_url || null,
    media_name: m.media_name || null,
    direction: m.direction || 'inbound',
    channel: m.channel || null,
    sent_at: m.sent_at || new Date().toISOString(),
    created_at: m.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from('messages').insert(rows, { upsert: false });
  if (error) {
    console.error('Error inserting messages:', error);
    throw error;
  }
  console.log(`✓ Migrated ${rows.length} messages`);
}

/**
 * Verify migration
 */
async function verify() {
  console.log('\nVerifying migration...');
  const tables = [
    'profiles',
    'sendpulse_accounts',
    'bitrix24_accounts',
    'sendpulse_bots',
    'conversations',
    'messages',
  ];

  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`Error counting ${table}:`, error);
    } else {
      console.log(`✓ ${table}: ${count} rows`);
    }
  }
}

/**
 * Main migration flow
 */
async function runMigration() {
  console.log(`Starting migration from ${SOURCE_DIR} to ${SUPABASE_URL}\n`);

  try {
    await migrateProfiles();
    await migrateSendPulseAccounts();
    await migrateBitrix24Accounts();
    await migrateSendPulseBots();
    await migrateConversations();
    await migrateMessages();
    await verify();
    console.log('\n✅ Migration completed successfully!');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
