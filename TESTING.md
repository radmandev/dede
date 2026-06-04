# Testing Guide - Supabase Migration

## Overview

This guide covers testing the migrated Supabase backend, ensuring all Edge Functions work correctly, and validating data integrity after migration.

## Unit Testing - Edge Functions

### Setup

Install test dependencies:

```bash
npm install --save-dev @supabase/supabase-js jest deno_std
```

### Running Tests

```bash
# Test all Edge Functions
npm test supabase/functions

# Test a specific function
npm test supabase/functions/sendMessage

# Test with coverage
npm test --coverage
```

### Test Structure

Each function should have a `__tests__/index.test.ts` file:

```
supabase/functions/sendMessage/
├── entry.ts
└── __tests__/
    └── index.test.ts
```

### Example: Testing sendMessage

```typescript
// supabase/functions/sendMessage/__tests__/index.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const client = createClient(supabaseUrl, supabaseServiceKey);

Deno.test("sendMessage: sends WhatsApp message to SendPulse", async () => {
  // Mock conversation and message
  const conversation = {
    id: "test-conv-123",
    channel: "whatsapp",
    external_id: "1234567890@c.us",
    sendpulse_account_id: "test-account",
  };

  // Test message payload
  const payload = {
    conversation_id: conversation.id,
    text: "Hello World",
    template_name: null,
  };

  // Call the function
  const response = await client.functions.invoke("sendMessage", {
    body: payload,
  });

  // Verify response
  assertEquals(response.status, 200);
  assertExists(response.data.message_id);
});

Deno.test("sendMessage: rejects invalid conversation", async () => {
  const response = await client.functions.invoke("sendMessage", {
    body: {
      conversation_id: "invalid-id",
      text: "Test",
    },
  });

  assertEquals(response.status, 400);
});
```

## Integration Testing

### Testing Webhook Handlers

Test incoming webhook events:

```bash
# Simulate Bitrix24 webhook
curl -X POST http://localhost:54321/functions/v1/bitrix24Handler \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[AUTHOR_ID]=1&data[MESSAGE_ID]=123&data[MESSAGE]=Hello%20World"

# Simulate SendPulse webhook
curl -X POST http://localhost:54321/functions/v1/sendpulseWebhook \
  -H "Content-Type: application/json" \
  -d '{"event": "incoming", "message": {"text": "Hello"}}'
```

### Testing Queue Processing

Manually trigger the delivery queue processor:

```bash
# Process queue (should retry failed messages)
curl -X POST http://localhost:54321/functions/v1/processDeliveryQueue \
  -H "Authorization: Bearer $SERVICE_KEY"

# Verify queue state
SELECT * FROM delivery_queue WHERE attempts > 0 ORDER BY created_at DESC LIMIT 10;
SELECT * FROM delivery_errors WHERE created_at > NOW() - INTERVAL '1 hour';
```

## End-to-End Testing

### Scenario 1: WhatsApp Message Flow

1. **Setup**
   - Create user and profile via Sign Up
   - Connect SendPulse account (OAuth)
   - Create WhatsApp bot

2. **Test Steps**
   - Send message via MessageComposer
   - Verify message appears in delivery_queue
   - Verify message sent to SendPulse API (check logs)
   - Verify message created in messages table

3. **Validation**
   ```sql
   SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC;
   SELECT * FROM delivery_queue WHERE message_id = $1;
   ```

### Scenario 2: Bitrix24 Integration

1. **Setup**
   - Install app on Bitrix24 portal
   - Connect to open line
   - Map to SendPulse account

2. **Test Steps**
   - Send message in Bitrix24 chat
   - Webhook should trigger bitrix24Handler
   - Message should appear in PulseInbox

3. **Validation**
   ```sql
   SELECT * FROM messages WHERE external_id LIKE '%@c.us' ORDER BY created_at DESC;
   SELECT * FROM bitrix24_accounts WHERE portal_id = $1;
   ```

### Scenario 3: Reply Workflow

1. **Setup**
   - Send WhatsApp message (via PulseInbox)
   - Agent responds in Bitrix24

2. **Test Steps**
   - Message sent to Bitrix24 via webhook
   - Agent replies in Bitrix24
   - Webhook ONIMCONNECTORMESSAGEADD triggers
   - Reply appears in PulseInbox

3. **Validation**
   ```sql
   SELECT * FROM messages WHERE conversation_id = $1 AND role = 'agent' ORDER BY created_at DESC;
   ```

## Data Integrity Testing

### Pre-Migration Validation

```sql
-- Check table counts
SELECT 'profiles' as table_name, COUNT(*) FROM profiles
UNION SELECT 'sendpulse_accounts', COUNT(*) FROM sendpulse_accounts
UNION SELECT 'bitrix24_accounts', COUNT(*) FROM bitrix24_accounts
UNION SELECT 'conversations', COUNT(*) FROM conversations
UNION SELECT 'messages', COUNT(*) FROM messages;

-- Verify foreign keys
SELECT * FROM conversations WHERE sendpulse_account_id NOT IN (SELECT id FROM sendpulse_accounts);
SELECT * FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations);
```

### Post-Migration Validation

```sql
-- Check for orphaned records
SELECT COUNT(*) FROM messages m WHERE NOT EXISTS (
  SELECT 1 FROM conversations c WHERE c.id = m.conversation_id
);

-- Verify RLS (run as non-admin user)
SELECT COUNT(*) FROM profiles;  -- Should return only own profile
SELECT COUNT(*) FROM conversations;  -- Should return only own conversations

-- Check timestamp integrity
SELECT MIN(created_at), MAX(created_at) FROM messages;
```

## Performance Testing

### Query Performance

```sql
-- Check message list query performance (should be <100ms)
EXPLAIN ANALYZE
SELECT m.* FROM messages m
WHERE m.conversation_id = $1
ORDER BY m.created_at DESC
LIMIT 50;

-- Check conversation list query
EXPLAIN ANALYZE
SELECT c.* FROM conversations c
WHERE c.sendpulse_account_id = $1
ORDER BY c.updated_at DESC
LIMIT 20;
```

### Function Performance

Monitor function execution time:

```bash
# View function logs with timing
supabase functions logs sendMessage --tail 50

# Check average function duration
SELECT 
  function_name,
  COUNT(*) as calls,
  AVG(execution_ms) as avg_ms,
  MAX(execution_ms) as max_ms
FROM edge_function_logs
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY function_name;
```

### Load Testing

Use k6 for load testing:

```bash
npm install --save-dev k6
```

Create `k6-test.js`:

```javascript
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 10,
  duration: '30s',
};

export default function() {
  // Test sendMessage
  let res = http.post(
    'https://your-project.supabase.co/functions/v1/sendMessage',
    JSON.stringify({
      conversation_id: 'test-123',
      text: 'Load test message',
    }),
    {
      headers: {
        'Authorization': 'Bearer ' + __ENV.ANON_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

Run test:

```bash
k6 run k6-test.js -e ANON_KEY=$VITE_SUPABASE_ANON_KEY
```

## RLS Testing

### Test Owner-Scoped Access

```sql
-- As user A, create a conversation
INSERT INTO conversations (id, sendpulse_account_id, channel, external_id)
VALUES ('conv-user-a', 'acct-user-a', 'whatsapp', 'user_a@c.us');

-- As user B, try to read user A's conversation
SELECT * FROM conversations WHERE id = 'conv-user-a';
-- Should return empty (403 Forbidden at RLS level)
```

### Test Service Role Override

```sql
-- This query SHOULD work with service role key
-- (but should fail with anon key in client)
SELECT * FROM conversations;
```

## Monitoring Tests

### Alert Configuration

```sql
-- Create an alert for failed message delivery
CREATE VIEW failed_messages_alert AS
SELECT 
  m.id,
  m.conversation_id,
  dq.attempts,
  dq.next_retry_at
FROM delivery_queue dq
JOIN messages m ON m.id = dq.message_id
WHERE dq.attempts >= 3
AND dq.next_retry_at > NOW();

-- Query hourly
SELECT COUNT(*) FROM failed_messages_alert;
```

### Log Aggregation Tests

Verify logs are being captured:

```bash
# Check function logs
supabase functions logs

# Filter by function
supabase functions logs bitrix24Handler --tail 100

# Export logs for analysis
supabase functions logs > function-logs.txt
```

## Regression Testing Checklist

- [ ] User signup/login works
- [ ] SendPulse OAuth flow completes
- [ ] Bitrix24 OAuth flow completes
- [ ] Messages send to WhatsApp
- [ ] Messages send to Telegram
- [ ] Messages send to Instagram
- [ ] Messages send to Facebook
- [ ] Bitrix24 webhook receives messages
- [ ] Agent replies appear in PulseInbox
- [ ] Realtime subscriptions update UI
- [ ] File attachments upload to storage
- [ ] RLS prevents unauthorized access
- [ ] Admin queue shows pending messages
- [ ] Failed messages are retried
- [ ] Templates load in TemplateSelect
- [ ] Bots sync from SendPulse
- [ ] Open channels display correctly
- [ ] Queue processor runs every 2 minutes
- [ ] Tokens refresh before expiry

## Troubleshooting Tests

### Function Invocation Fails

```bash
# Check function deployment
supabase functions list

# View function logs
supabase functions logs sendMessage --tail 50

# Test locally
supabase start
supabase functions serve

# In another terminal
curl -X POST http://localhost:54321/functions/v1/sendMessage \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "test", "text": "hello"}'
```

### RLS Permission Denied

```sql
-- Check user's auth.uid()
SELECT auth.uid();

-- Verify profile exists
SELECT * FROM profiles WHERE auth_uid = auth.uid();

-- Check RLS policy
SELECT * FROM pg_policies WHERE tablename = 'conversations';
```

### Messages Not Delivering

```sql
-- Check delivery queue
SELECT * FROM delivery_queue WHERE attempts < max_attempts ORDER BY next_retry_at;

-- Check errors
SELECT * FROM delivery_errors WHERE created_at > NOW() - INTERVAL '1 hour';

-- Verify SendPulse token
SELECT * FROM sendpulse_accounts WHERE id = $1;
```

## Continuous Testing

Add to CI/CD (GitHub Actions):

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: denoland/setup-deno@v1
      - run: npm install
      - run: npm test
      - run: supabase functions test
```
