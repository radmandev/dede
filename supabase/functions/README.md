Supabase Edge Functions (Deno) scaffold

This folder contains several Supabase Edge Functions adapted for Supabase Functions (Deno runtime):

- `sendpulseWebhook` — handles incoming SendPulse webhook payloads, logs raw payloads to `webhook_logs`, and creates/updates `conversations` and `messages` rows.
- `sendMessage` — accepts POST requests to persist outbound messages and performs SendPulse delivery or queueing.
- `bitrix24Handler` — receives Bitrix24 event callbacks and inserts outbound agent messages into conversations.
- `bitrix24Installer` — serves Bitrix24 installer pages and registers the connector/placements during installation.
- `bitrix24ListLines` — fetches available Bitrix24 Open Line options for a connected portal.
- `bitrix24RegisterConnector` — registers and activates the Bitrix24 connector for a configured Open Channel.
- `bitrix24BindReplyWebhook` — binds Bitrix24 reply webhooks to the app handler endpoint.
- `bitrix24PollReplies` — polls Bitrix24 for missed replies as a fallback safety net.
- `sendpulseSyncBots` — synchronizes SendPulse bots and ensures webhooks are registered for the account.
- `getSendPulseTemplates` — fetches approved SendPulse templates for a selected bot.

Environment variables required (set in Supabase project settings or via `supabase secrets`):

- `SUPABASE_URL` (e.g., https://gxhiabxjvzmumxxmsnhy.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only service role key)
- `WEBHOOK_SECRET` (optional; used to verify incoming webhooks)

Deploying locally and to Supabase:

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Login and select project:

```bash
supabase login
supabase link --project-ref gxhiabxjvzmumxxmsnhy
```

3. Deploy functions:

```bash
supabase functions deploy sendpulseWebhook --project-ref gxhiabxjvzmumxxmsnhy
supabase functions deploy sendMessage --project-ref gxhiabxjvzmumxxmsnhy
```

4. To run locally during development:

```bash
supabase functions serve sendpulseWebhook
supabase functions serve sendMessage
```

Notes:
- Adapt payload mapping inside the functions to match the exact SendPulse/Bitrix webhook shapes.
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret; do not expose to the client.
- Add unit/integration tests and integrate deployment into CI (GitHub Actions recommended).

Retry & queue
- `delivery_queue` and `delivery_errors` tables (see `supabase/migrations/003_delivery_queue.sql`) provide a persistent queue.
- `processDeliveryQueue` function processes pending deliveries; schedule it periodically (e.g., every 30s-2m) using an external cron or Supabase scheduled functions.

To deploy and schedule processing using a simple cron on a server, add a cron entry that calls the function endpoint regularly, or use Supabase's scheduled functions when available.
