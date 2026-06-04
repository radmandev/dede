# Supabase Migration - Deployment Guide

## Overview

This guide covers deploying the Supabase-migrated app with all Edge Functions, storage, auth, and realtime features.

## Prerequisites

- Supabase project created at https://supabase.com
- Supabase CLI installed: `npm install -g supabase`
- Hostinger account for frontend hosting (FTP access)
- SendPulse and Bitrix24 API credentials

## Environment Setup

### 1. Supabase Configuration

Create `.env.local` with Supabase credentials:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_STORAGE_BUCKET=attachments
```

For server-side operations (Edge Functions), configure in Supabase dashboard:
- **SUPABASE_URL** (auto-configured)
- **SUPABASE_SERVICE_ROLE_KEY** (sensitive—keep secure)
- **WEBHOOK_SECRET** (optional—for validating incoming webhooks)

### 2. External Integration Credentials

Store in Supabase `global_config` table via the Settings page:

- **bitrix24_app_client_id**: Bitrix24 marketplace app client ID
- **bitrix24_app_client_secret**: Bitrix24 marketplace app client secret
- **app_base_url**: Production app URL (e.g., `https://yourapp.com`)

## Deployment Steps

### Step 1: Deploy Database Schema & RLS

```bash
supabase db push

# Or manually run migrations:
psql $SUPABASE_URL < supabase/migrations/001_create_core_tables.sql
psql $SUPABASE_URL < supabase/migrations/002_indexes_and_rls.sql
psql $SUPABASE_URL < supabase/migrations/003_delivery_queue.sql
```

### Step 2: Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy bitrix24Handler
supabase functions deploy bitrix24Installer
supabase functions deploy bitrix24ListLines
supabase functions deploy bitrix24BindReplyWebhook
supabase functions deploy bitrix24RegisterConnector
supabase functions deploy bitrix24PollReplies
supabase functions deploy sendpulseSyncBots
supabase functions deploy getSendPulseTemplates
supabase functions deploy sendMessage
supabase functions deploy sendpulseWebhook
supabase functions deploy adminGetDelivery
supabase functions deploy adminManageDelivery
supabase functions deploy processDeliveryQueue
```

### Step 3: Set Up Storage Bucket

```bash
# Create the attachments bucket (public, auto-delete old files after 30 days)
curl -X POST https://your-project.supabase.co/storage/v1/b \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "attachments",
    "public": true
  }'
```

### Step 4: Configure RLS on Storage Bucket

```sql
-- Allow authenticated users to upload and download their own files
CREATE POLICY "Users can upload attachments"
  ON storage.objects
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can download attachments"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'attachments');
```

### Step 5: Migrate Data

```bash
# Export Base44 data (if available):
node scripts/migrate-data.js ./base44-export

# Alternatively, use Supabase dashboard to import CSVs
```

### Step 6: Build and Deploy Frontend

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Deploy to Hostinger (via FTP)
# Configured in .github/workflows/hostinger-deploy.yml
# Trigger: push to main branch
```

### Step 7: Enable Realtime

In Supabase dashboard → Realtime:
- Enable realtime for `public` schema
- Add replication to tables: `messages`, `conversations`, `delivery_queue`

### Step 8: Schedule Queue Processing

Option A: Use GitHub Actions (recommended)
```bash
# Queue processor runs every 2 minutes
# Configured in .github/workflows/process-queue.yml
git push origin main
```

Option B: External cron (e.g., cron-job.org)
```bash
# Call every 2 minutes:
curl https://your-project.supabase.co/functions/v1/processDeliveryQueue \
  -H "Authorization: Bearer $SERVICE_KEY"
```

## Post-Deployment Checklist

- [ ] Verify all Edge Functions are deployed: `supabase functions list`
- [ ] Test SendPulse webhook: send test message via SendPulse dashboard
- [ ] Test Bitrix24 integration: install app on Bitrix24 portal
- [ ] Verify Realtime subscriptions: check browser console for subscription messages
- [ ] Monitor queue: check AdminQueue dashboard for pending deliveries
- [ ] Test user auth: sign up and verify profile creation
- [ ] Verify RLS: ensure users only see their own data
- [ ] Check storage: upload attachment and verify URL generation

## Rollback Plan

If issues arise:

1. **Database Rollback**: Restore from Supabase backup (24-hour retention by default)
   ```bash
   supabase db pull  # Restore from latest backup
   ```

2. **Edge Functions Rollback**: Redeploy previous version
   ```bash
   git revert <commit-hash>
   supabase functions deploy [function-name]
   ```

3. **Frontend Rollback**: Redeploy previous build to Hostinger
   - Upload previous build via FTP
   - Manually trigger `.github/workflows/hostinger-deploy.yml`

## Monitoring & Logs

View Edge Function logs:
```bash
supabase functions logs bitrix24Handler
supabase functions logs sendMessage
```

Monitor queue backlog:
```sql
SELECT COUNT(*) as pending FROM delivery_queue WHERE attempts < max_attempts;
SELECT COUNT(*) as failed FROM delivery_errors;
```

Check RLS violations:
```sql
SELECT * FROM pg_stat_statements WHERE query LIKE '%permission denied%' LIMIT 10;
```

## Support & Troubleshooting

- **Issue**: Webhook not received
  - Check global_config.app_base_url is set correctly
  - Verify webhook URLs in Bitrix24/SendPulse dashboards
  - Check WEBHOOK_SECRET matches in Supabase environment

- **Issue**: Messages not delivering
  - Check delivery_queue and delivery_errors tables
  - Verify SendPulse/Bitrix24 token refresh working (check logs)
  - Ensure processDeliveryQueue is running every 2 minutes

- **Issue**: RLS permission denied
  - Verify user profile exists in profiles table
  - Check auth.uid() matches user's auth_uid
  - Review RLS policies in supabase/migrations/002_indexes_and_rls.sql

- **Issue**: Storage upload fails
  - Verify attachments bucket exists
  - Check RLS policies on storage.objects
  - Ensure user is authenticated
