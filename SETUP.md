# Environment Setup Guide

## Prerequisites

- Node.js 18+ and npm
- Supabase CLI: `npm install -g supabase`
- GitHub account and repository
- Hostinger FTP credentials

## Local Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/pulseinbox.git
cd pulseinbox
npm install
```

### 2. Create Supabase Project

Visit https://supabase.com:
1. Create new project
2. Copy project URL and anon key
3. Generate service role key (Settings → API)

### 3. Configure Environment Variables

Create `.env.local` in project root:

```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_SUPABASE_STORAGE_BUCKET=attachments

# For local Supabase testing (optional)
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=your-local-service-key
```

For GitHub Actions, add secrets to repository:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_ID`
- `SUPABASE_ACCESS_TOKEN`
- `HOSTINGER_FTP_HOST`
- `HOSTINGER_FTP_USER`
- `HOSTINGER_FTP_PASS`
- `SLACK_WEBHOOK_URL` (optional)

### 4. Initialize Supabase Locally

```bash
supabase start

# Observe local Supabase URL (default: http://localhost:54321)
# Copy local service role key for testing
```

### 5. Push Database Schema

```bash
supabase db push

# Or run migrations manually
psql "postgresql://postgres:postgres@localhost:54322/postgres" < supabase/migrations/*.sql
```

### 6. Deploy Edge Functions Locally

```bash
supabase functions serve

# In another terminal, test a function:
curl -X POST http://localhost:54321/functions/v1/sendMessage \
  -H "Authorization: Bearer $LOCAL_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "test", "text": "hello"}'
```

### 7. Start Development Server

```bash
npm run dev

# Open http://localhost:5173
```

## Production Deployment

### 1. Push Schema to Production

```bash
# Connect to production project
supabase link --project-ref your-project-id

# Push migrations
supabase db push
```

### 2. Deploy Edge Functions

```bash
# Deploy all functions
for func in supabase/functions/*/; do
  supabase functions deploy "$(basename $func)" --project-ref your-project-id
done
```

Or use GitHub Actions (recommended):
```bash
git push origin main
# Workflow automatically deploys on push
```

### 3. Build Frontend

```bash
npm run build

# Output in dist/
```

### 4. Deploy to Hostinger

Configure FTP credentials in `.github/workflows/hostinger-deploy.yml`:

```yaml
- name: Deploy to Hostinger
  uses: wangyucode/sftp-upload-action@v2.0.2
  with:
    host: ${{ secrets.HOSTINGER_FTP_HOST }}
    username: ${{ secrets.HOSTINGER_FTP_USER }}
    password: ${{ secrets.HOSTINGER_FTP_PASS }}
    localDir: dist/
    remoteDir: /public_html/
```

Then:
```bash
git push origin main
# Workflow automatically builds and deploys
```

## Database Migrations

### Creating New Migrations

```bash
supabase migration new add_column_to_messages
# Edit supabase/migrations/[timestamp]_add_column_to_messages.sql
supabase db push
```

### Manual Migration (if needed)

```bash
psql $SUPABASE_URL < supabase/migrations/[timestamp]_migration_name.sql
```

### Viewing Migration Status

```bash
supabase migration list --project-ref your-project-id
```

## External API Credentials

Store in Supabase `global_config` table via Settings page:

| Key | Description | Required | Format |
|-----|-------------|----------|--------|
| `app_base_url` | Production app URL | ✓ | `https://app.example.com` |
| `bitrix24_app_client_id` | Bitrix24 marketplace app ID | ✓ | String |
| `bitrix24_app_client_secret` | Bitrix24 marketplace app secret | ✓ | String |

## Webhook Configuration

### Bitrix24

1. In Bitrix24 marketplace → Your App → Settings:
   - **Handler URL**: `https://your-app.com/api/functions/bitrix24Handler`
   - **Installer URL**: `https://your-app.com/api/functions/bitrix24Installer`
   - **Required permissions**: `im`, `imconnector`, `imopenlines`

2. In PulseInbox Settings:
   - Configure **App Base URL**
   - Configure **Bitrix24 App Credentials**
   - Click **Connect Reply Webhook** (once per portal)

### SendPulse

1. Connect SendPulse account via OAuth (in app → SendPulse Accounts)
2. Webhooks automatically registered by `sendpulseSyncBots` function
3. Webhook endpoints:
   - **WhatsApp**: `https://your-app.com/api/functions/sendpulseWebhook?channel=whatsapp`
   - **Telegram**: `https://your-app.com/api/functions/sendpulseWebhook?channel=telegram`
   - **Instagram**: `https://your-app.com/api/functions/sendpulseWebhook?channel=instagram`
   - **Facebook**: `https://your-app.com/api/functions/sendpulseWebhook?channel=facebook`
   - **Live Chat**: `https://your-app.com/api/functions/sendpulseWebhook?channel=live_chat`

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
# Test local Supabase
supabase start
npm test:integration
```

### Manual Endpoint Testing

```bash
# Test sendMessage
curl -X POST http://localhost:54321/functions/v1/sendMessage \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "test-123",
    "text": "Hello World"
  }'

# Test getSendPulseTemplates
curl -X POST http://localhost:54321/functions/v1/getSendPulseTemplates \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-123"}'
```

## Troubleshooting

### Supabase Connection Issues

```bash
# Check project status
supabase projects list

# Verify credentials
echo $VITE_SUPABASE_URL
echo $VITE_SUPABASE_ANON_KEY

# Test connection
curl -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  $VITE_SUPABASE_URL/rest/v1/profiles?limit=1
```

### Edge Function Errors

```bash
# View function logs
supabase functions logs sendMessage --tail 100

# Check function deployment
supabase functions list

# Test locally
supabase functions serve
# In another terminal:
curl -X POST http://localhost:54321/functions/v1/sendMessage \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "test", "text": "hello"}'
```

### RLS Permission Errors

```sql
-- Check your user ID
SELECT auth.uid();

-- Verify profile exists
SELECT * FROM profiles WHERE auth_uid = auth.uid();

-- Check RLS policies
SELECT * FROM pg_policies WHERE schemaname = 'public';
```

### Build/Deploy Issues

```bash
# Clear cache
rm -rf node_modules dist .supabase
npm install

# Rebuild
npm run build

# Check bundle size
npm run build -- --analyze
```

## Performance Optimization

### Database Indexes

Indexes are created in migrations. Verify:

```sql
SELECT * FROM pg_indexes WHERE schemaname = 'public';
```

### Query Optimization

Use explain analyze:

```sql
EXPLAIN ANALYZE
SELECT * FROM conversations WHERE sendpulse_account_id = '123'
ORDER BY updated_at DESC LIMIT 20;
```

### Function Optimization

Monitor function duration:

```bash
supabase functions logs --project-ref your-project-id | grep "execution_ms"
```

## Monitoring & Alerting

### Supabase Monitoring

Dashboard available at: https://supabase.com/dashboard/project/your-project/logs

### Error Tracking

Errors logged to `delivery_errors` table:

```sql
SELECT * FROM delivery_errors 
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;
```

### Health Checks

```bash
# Check function availability
for func in bitrix24Handler sendMessage getSendPulseTemplates; do
  curl -X GET https://your-project.supabase.co/functions/v1/$func \
    -H "Authorization: Bearer $ANON_KEY" | head -c 50
done
```

## Useful Commands

```bash
# View database schema
supabase db pull

# Start local development
supabase start && npm run dev

# Run type checking
deno check supabase/functions/*/entry.ts

# Deploy specific function
supabase functions deploy sendMessage --project-ref your-project-id

# View real-time subscriptions
supabase realtime inspect

# Backup database
supabase db download --project-ref your-project-id

# Access production database
psql $SUPABASE_URL
```

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/guides/cli)
- [Edge Functions Guide](https://supabase.com/docs/guides/functions)
- [RLS Policy Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Deployment Guide](./DEPLOYMENT.md)
- [Testing Guide](./TESTING.md)
