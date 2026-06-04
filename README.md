# PulseInbox - Omnichannel Chat Manager

[![Deploy Supabase Functions](https://github.com/your-org/pulseinbox/actions/workflows/deploy-functions.yml/badge.svg)](https://github.com/your-org/pulseinbox/actions/workflows/deploy-functions.yml)
[![Deploy to Hostinger](https://github.com/your-org/pulseinbox/actions/workflows/hostinger-deploy.yml/badge.svg)](https://github.com/your-org/pulseinbox/actions/workflows/hostinger-deploy.yml)

## Overview

PulseInbox is a modern omnichannel messaging platform that unifies WhatsApp, Telegram, Instagram, Facebook, and Live Chat conversations in a single inbox. It integrates with **Bitrix24** for CRM/support workflows and **SendPulse** for message automation.

**Key Features:**
- 📱 Multi-channel messaging (WhatsApp, Telegram, Instagram, Facebook, Live Chat)
- 🔄 Real-time message synchronization with Bitrix24
- 🤖 SendPulse chatbot integration
- 📋 Message templates and automation
- 📦 File attachments with Supabase Storage
- 🔐 Role-based access control with RLS
- 📊 Admin dashboard for queue management
- ⚡ Real-time Realtime subscriptions
- 🚀 Serverless Edge Functions for high availability

## Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **React Query** - Server state management
- **Supabase.js** - Database and auth client
- **Sonner** - Toast notifications

### Backend
- **Supabase** - Postgres database + Auth + Storage + Realtime
- **Deno** - Edge Functions runtime
- **OAuth 2.0** - SendPulse & Bitrix24 integration

### Infrastructure
- **Supabase Cloud** - Backend hosting
- **Hostinger** - Frontend hosting (FTP deployment)
- **GitHub Actions** - CI/CD pipeline

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account (https://supabase.com)
- Bitrix24 portal (optional, for CRM integration)
- SendPulse account (optional, for messaging)

### Quick Start

1. **Clone & Install**
   ```bash
   git clone https://github.com/your-org/pulseinbox.git
   cd pulseinbox
   npm install
   ```

2. **Setup Environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Supabase credentials
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   # Open http://localhost:5173
   ```

### Detailed Setup
See [SETUP.md](./SETUP.md) for:
- Local Supabase development
- Database migrations
- Edge Functions deployment
- External API credentials

## Architecture

### Database Schema

Core tables with owner-scoped RLS:

```
profiles (auth_uid)
  ├── sendpulse_accounts (owner_id)
  │   ├── sendpulse_bots
  │   └── conversations
  │       └── messages
  │           └── attachments (storage)
  └── bitrix24_accounts (owner_id)
      └── bitrix24_open_channels
          └── conversations
              └── messages
```

**Authentication**: Supabase Auth (email/password, OAuth)
**Authorization**: Row-Level Security (RLS) policies
**Real-time**: Supabase Realtime subscriptions on `messages` table

### Edge Functions

13 serverless functions handle async operations:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `bitrix24Handler` | Webhook | Receive Bitrix24 messages |
| `bitrix24Installer` | Webhook | Handle app installation |
| `bitrix24ListLines` | API call | Fetch Bitrix24 Open Lines |
| `bitrix24BindReplyWebhook` | Manual | Connect reply webhook |
| `bitrix24RegisterConnector` | API call | Register WhatsApp connector |
| `bitrix24PollReplies` | Cron (5m) | Poll missed replies |
| `sendMessage` | API call | Send message to SendPulse |
| `getSendPulseTemplates` | API call | Fetch message templates |
| `sendpulseSyncBots` | Manual | Sync bots & webhooks |
| `sendpulseWebhook` | Webhook | Receive SendPulse messages |
| `adminGetDelivery` | API call | Fetch queue status (admin) |
| `adminManageDelivery` | API call | Retry/cancel messages (admin) |
| `processDeliveryQueue` | Cron (2m) | Process outbound queue |

### Delivery Pipeline

```
User sends message
  ↓
sendMessage function validates
  ↓
Message inserted into messages table
  ↓
Delivery queue entry created
  ↓
Realtime notifies subscribers
  ↓
processDeliveryQueue runs every 2m
  ↓
Retry failed deliveries (exponential backoff)
  ↓
Update delivery_errors on failure
```

## Features

### 1. Multi-Channel Messaging
- WhatsApp, Telegram, Instagram, Facebook, Live Chat
- Message templates via SendPulse
- File attachments (images, videos, documents)
- Automatic reply templates

### 2. Bitrix24 Integration
- OAuth 2.0 authentication
- Marketplace app installation
- Open Line connector registration
- Real-time webhook for incoming messages
- Agent reply synchronization

### 3. SendPulse Integration
- OAuth 2.0 authentication
- Chatbot sync and management
- Webhook registration for all channels
- Template library management
- Outbound message delivery

### 4. Admin Dashboard
- Message delivery queue status
- Failed delivery error logs
- Retry management
- Per-account statistics

### 5. Real-time Features
- Live message updates via Realtime subscriptions
- Presence indicators
- Typing status (when available)
- Connection status monitoring

### 6. Security
- Row-Level Security (RLS) for data isolation
- OAuth 2.0 for third-party integrations
- Service role key for server-side operations
- HTTPS-only communication
- Encrypted token storage

## Deployment

### Frontend
```bash
npm run build
git push origin main  # Triggers GitHub Actions → Hostinger deploy
```

### Backend
```bash
supabase functions deploy [function-name]
# Or push to main → GitHub Actions deploys all functions
```

### Database Migrations
```bash
supabase db push
# Applies pending migrations to production
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

## Testing

Run automated tests:
```bash
npm test                    # Unit tests
npm test:integration       # Integration tests
npm test:e2e              # End-to-end tests
```

Manual testing guide: [TESTING.md](./TESTING.md)

## Configuration

### Environment Variables

**Frontend** (`.env.local`):
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_STORAGE_BUCKET=attachments
```

**Backend** (Supabase Edge Functions):
- Auto-configured with project credentials
- Service role key for server operations
- Webhook secret for validation (optional)

### Global Settings

Stored in `global_config` table, editable via Settings page:

| Setting | Example | Purpose |
|---------|---------|---------|
| `app_base_url` | `https://pulseinbox.com` | Bitrix24 webhook URLs |
| `bitrix24_app_client_id` | `abc123...` | OAuth credential |
| `bitrix24_app_client_secret` | `def456...` | OAuth credential |

## API Reference

### sendMessage

Send a message to a conversation:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/sendMessage \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv-123",
    "text": "Hello!",
    "template_name": null
  }'
```

### getSendPulseTemplates

Fetch approved templates for a bot:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/getSendPulseTemplates \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"botId": "bot-456"}'
```

### bitrix24ListLines

List available Open Lines:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/bitrix24ListLines \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"bitrix24_account_id": "acct-789"}'
```

See [supabase/functions/README.md](./supabase/functions/README.md) for all functions.

## Troubleshooting

### Common Issues

**Messages not sending?**
- Check `delivery_queue` and `delivery_errors` tables
- Verify SendPulse token is valid
- Review Edge Function logs: `supabase functions logs sendMessage`

**Bitrix24 webhook not triggering?**
- Verify app is installed on the portal
- Check app base URL in Settings matches production URL
- Reconnect reply webhook: Settings → Connect Reply Webhook

**RLS permission denied?**
- Ensure user profile exists
- Verify `auth.uid()` matches profile `auth_uid`
- Review RLS policies in `supabase/migrations/002_indexes_and_rls.sql`

See [TESTING.md](./TESTING.md#troubleshooting) for more troubleshooting steps.

## Monitoring

### Logging
```bash
# View function logs
supabase functions logs [function-name] --tail 100

# Export logs for analysis
supabase functions logs > function-logs.txt
```

### Metrics
```sql
-- Message throughput
SELECT DATE(created_at), COUNT(*) FROM messages GROUP BY DATE(created_at);

-- Delivery success rate
SELECT 
  COUNT(CASE WHEN status = 'delivered' THEN 1 END) as sent,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM messages;

-- Queue backlog
SELECT COUNT(*) FROM delivery_queue WHERE attempts < max_attempts;
```

### Alerts
- Failed deliveries exceeding threshold
- Function execution time > 30s
- Auth token refresh failures
- Storage quota exceeded

## Development

### Local Development with Supabase

```bash
# Start local Supabase
supabase start

# Deploy functions locally
supabase functions serve

# In another terminal, run frontend
npm run dev
```

### File Structure

```
pulseinbox/
├── src/
│   ├── components/       # React components
│   ├── pages/           # Page components
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utilities (auth, storage, etc.)
│   ├── api/             # API clients
│   └── utils/           # Helper functions
├── supabase/
│   ├── migrations/      # Database migrations
│   └── functions/       # Edge Functions (Deno)
├── public/              # Static assets
├── scripts/             # Utility scripts
├── .github/workflows/   # CI/CD workflows
├── SETUP.md            # Setup guide
├── DEPLOYMENT.md       # Deployment guide
└── TESTING.md          # Testing guide
```

### Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes and test locally
3. Push to GitHub: `git push origin feature/my-feature`
4. Open a Pull Request
5. GitHub Actions will test and deploy on merge

## Performance

### Optimization Tips

1. **Database**: Queries are indexed for fast lookups
   ```sql
   SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;
   ```

2. **Functions**: Monitor execution time and optimize
   ```bash
   supabase functions logs | grep "execution_ms"
   ```

3. **Frontend**: Use React.lazy() for code splitting, enable tree-shaking
   ```bash
   npm run build -- --analyze
   ```

4. **Caching**: Leverage React Query with smart invalidation strategies

## Roadmap

- [ ] Email message integration
- [ ] WhatsApp Business API (move from SendPulse)
- [ ] Advanced analytics dashboard
- [ ] Message search and filtering
- [ ] Custom workflows/automations
- [ ] Multi-user team collaboration
- [ ] Message scheduling

## Support & Documentation

- **Setup Guide**: [SETUP.md](./SETUP.md)
- **Deployment Guide**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Testing Guide**: [TESTING.md](./TESTING.md)
- **API Reference**: [supabase/functions/README.md](./supabase/functions/README.md)
- **Issues**: [GitHub Issues](https://github.com/your-org/pulseinbox/issues)

## License

[Add your license here]

## Acknowledgments

Built with [Supabase](https://supabase.com), [Vite](https://vitejs.dev), and [shadcn/ui](https://ui.shadcn.com)
