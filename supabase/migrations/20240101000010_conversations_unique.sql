-- 010_conversations_unique.sql
-- The sendpulseWebhook upserts on sendpulse_conversation_id, but no UNIQUE
-- constraint existed — PostgreSQL rejects ON CONFLICT without one, so every
-- incoming message silently failed to create a conversation.

-- Remove any orphaned rows with null/empty conversation IDs first
DELETE FROM conversations
WHERE sendpulse_conversation_id IS NULL OR sendpulse_conversation_id = '';

-- Add the unique constraint the upsert requires
ALTER TABLE conversations
  ADD CONSTRAINT conversations_sendpulse_conv_id_unique
  UNIQUE (sendpulse_conversation_id);
