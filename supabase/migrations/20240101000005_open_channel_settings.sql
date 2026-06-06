-- Add settings JSONB column to bitrix24_open_channels
-- Stores ChatApp-style connection settings: show_messages_from, chat_settings,
-- exclude_duplicates_in_crm, sync_to_responsible
ALTER TABLE bitrix24_open_channels
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
