# Complete Deployment & Continuation Guide

**Last Updated**: June 2026  
**Status**: Phase 2 Complete, Ready for Phase 3+  
**Session**: Continuation Guide for Future Development

---

## Table of Contents

1. [Phase 2 Status (Completed)](#phase-2-status-completed)
2. [Supabase Setup & Deployment](#supabase-setup--deployment)
3. [GitHub Setup & CI/CD](#github-setup--cicd)
4. [Hostinger Setup & Deployment](#hostinger-setup--deployment)
5. [Phase 3: Testing & CI/CD (TODO)](#phase-3-testing--cicd-todo)
6. [Phase 4: Monitoring & Rollback (TODO)](#phase-4-monitoring--rollback-todo)
7. [Phase 5: Data Migration (TODO)](#phase-5-data-migration-todo)
8. [Phase 6: Production Release (TODO)](#phase-6-production-release-todo)
9. [Phase 7: Decommission (TODO)](#phase-7-decommission-todo)
10. [Complete Checklist](#complete-checklist)

---

## Phase 2 Status (Completed)

✅ **All 13 Edge Functions Migrated**
- bitrix24Handler, bitrix24Installer, bitrix24ListLines
- bitrix24BindReplyWebhook, bitrix24RegisterConnector, bitrix24PollReplies
- sendMessage, getSendPulseTemplates, sendpulseSyncBots
- sendpulseWebhook, adminGetDelivery, adminManageDelivery
- processDeliveryQueue

✅ **Frontend Integration Complete**
- base44Client wrapper updated
- All components verified

✅ **Documentation Created**
- README, SETUP, DEPLOYMENT, TESTING, MIGRATION_STATUS
- INDEX, COMPLETION_SUMMARY, DEPLOYMENT_CHECKLIST

✅ **Database Schema Ready**
- 13 tables with RLS policies
- Migrations ready to deploy

---

## Supabase Setup & Deployment

### Step 1: Create Supabase Project

**Time**: 5 minutes

```bash
# 1. Visit https://supabase.com and sign in
# 2. Click "New Project"
# 3. Fill in:
#    - Organization: Select or create
#    - Project Name: pulseinbox-prod (or pulseinbox-staging)
#    - Database Password: Generate strong password, SAVE IT
#    - Region: Select closest to users
# 4. Click "Create new project" and wait 2-3 minutes
```

**After Creation:**
```bash
# Copy these from Project Settings → API
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Step 2: Link Local Project to Supabase

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Link to your Supabase project
cd /workspaces/pulseinbox
supabase link --project-ref your-project-id

# When prompted, enter your database password
```

### Step 3: Push Database Schema

```bash
# Test migrations locally first
supabase start
supabase db push  # This applies migrations to LOCAL database

# Verify local database
psql postgresql://postgres:postgres@localhost:54322/postgres

# When ready for production, push to live project
supabase db push --linked  # Applies to production project
```

**Expected Output:**
```
Applying migration: 20240101120000_create_core_tables
✓ Remote database migrations up to date
```

### Step 4: Deploy Edge Functions

```bash
# Deploy all 13 functions
for func in bitrix24Handler bitrix24Installer bitrix24ListLines \
            bitrix24BindReplyWebhook bitrix24RegisterConnector bitrix24PollReplies \
            sendMessage getSendPulseTemplates sendpulseSyncBots \
            sendpulseWebhook adminGetDelivery adminManageDelivery processDeliveryQueue; do
  supabase functions deploy $func --project-ref your-project-id
done

# Verify deployments
supabase functions list --project-ref your-project-id
```

**Expected Output:**
```
✓ bitrix24Handler deployed
✓ bitrix24Installer deployed
✓ sendMessage deployed
... (13 total)
```

### Step 5: Configure Storage Bucket

In **Supabase Dashboard** → **Storage**:

```bash
# 1. Click "Create a new bucket"
# 2. Name: attachments
# 3. Make it Public (for signed URLs)
# 4. Leave other options default
# 5. Click "Create bucket"
```

**Configure RLS Policies:**

In **Storage** → **Policies** → **attachments**:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Users can upload attachments"
ON storage.objects
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to download
CREATE POLICY "Users can download attachments"
ON storage.objects
FOR SELECT
USING (bucket_id = 'attachments');

-- Allow deletion of own files
CREATE POLICY "Users can delete own attachments"
ON storage.objects
FOR DELETE
USING (auth.role() = 'authenticated');
```

### Step 6: Configure Authentication

In **Supabase Dashboard** → **Auth** → **Providers**:

1. **Email/Password** (should be enabled by default)
   - Confirm email enabled (optional)
   - Confirmable email toggle ON

2. **OAuth Providers** (if needed):
   - Click "Enable" for any OAuth providers you want
   - Add Client ID/Secret for SendPulse/Bitrix24
   - Configure redirect URLs

### Step 7: Enable Realtime

In **Supabase Dashboard** → **Realtime**:

1. Click the three dots on "public" schema
2. Click "Enable replication for this schema"
3. Select tables for replication:
   - [ ] messages (REQUIRED)
   - [ ] conversations (recommended)
   - [ ] delivery_queue (optional)

```bash
# Test from CLI
supabase functions logs --project-ref your-project-id --tail 50
```

### Step 8: Set Environment Variables in Supabase

In **Supabase Dashboard** → **Project Settings** → **Functions** (if available):

Or in your `.env.local` file:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
```

### Step 9: Configure Global Settings

In your app, go to **Settings** and configure:

- **app_base_url**: https://your-production-domain.com
- **bitrix24_app_client_id**: [from Bitrix24 marketplace]
- **bitrix24_app_client_secret**: [from Bitrix24 marketplace]

These are stored in the `global_config` table and used by Edge Functions.

### Step 10: Test Supabase Setup

```bash
# Test authentication
curl -X POST https://your-project.supabase.co/auth/v1/signup \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPassword123"}'

# Test Edge Function
curl -X POST https://your-project.supabase.co/functions/v1/sendMessage \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"test","text":"hello"}'

# Expected response: {"data": {...}} or error message
```

---

## GitHub Setup & CI/CD

### Step 1: Create GitHub Repository

```bash
# 1. Go to https://github.com/new
# 2. Fill in:
#    - Repository name: pulseinbox
#    - Description: Omnichannel messaging platform
#    - Visibility: Private (or Public)
# 3. Click "Create repository"

# 2. Push existing code to GitHub
cd /workspaces/pulseinbox
git remote add origin https://github.com/your-org/pulseinbox.git
git branch -M main
git push -u origin main
```

### Step 2: Add Repository Secrets

In **GitHub** → **Settings** → **Secrets and variables** → **Actions**:

Click "New repository secret" for each:

```
SUPABASE_URL = https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJ...
SUPABASE_PROJECT_ID = your-project-id
SUPABASE_ACCESS_TOKEN = your-access-token (from Supabase)
HOSTINGER_FTP_HOST = ftp.yourdomain.com
HOSTINGER_FTP_USER = ftp-username
HOSTINGER_FTP_PASS = ftp-password
SLACK_WEBHOOK_URL = https://hooks.slack.com/... (optional)
```

**How to get SUPABASE_ACCESS_TOKEN:**
1. Go to https://supabase.com/dashboard/account/tokens
2. Click "Generate new token"
3. Name it: GitHub Actions
4. Copy and paste into GitHub secret

### Step 3: Create GitHub Actions Workflows

The workflow file should already exist at `.github/workflows/deploy-functions.yml`

**Verify it exists:**
```bash
cat .github/workflows/deploy-functions.yml
```

**If missing, create it:**
```bash
mkdir -p .github/workflows
# Copy from DEPLOYMENT.md deploy-functions.yml section
```

### Step 4: Create Frontend Deploy Workflow (if needed)

Create `.github/workflows/deploy-frontend.yml`:

```yaml
name: Deploy Frontend to Hostinger

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'public/**'
      - 'vite.config.js'
      - 'package.json'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      
      - name: Deploy to Hostinger
        uses: wangyucode/sftp-upload-action@v2.0.2
        with:
          host: ${{ secrets.HOSTINGER_FTP_HOST }}
          username: ${{ secrets.HOSTINGER_FTP_USER }}
          password: ${{ secrets.HOSTINGER_FTP_PASS }}
          localDir: dist/
          remoteDir: /public_html/
```

### Step 5: Test GitHub Actions

```bash
# Make a test commit
git add .
git commit -m "test: verify github actions"
git push origin main

# Watch the workflow run
# Go to GitHub → Actions tab
# Should see "Deploy Supabase Functions" workflow
```

### Step 6: Create GitHub Branch Protection Rules (Optional)

In **GitHub** → **Settings** → **Branches** → **Add rule**:

- Branch name pattern: `main`
- [ ] Require a pull request before merging
- [ ] Require approvals (2)
- [ ] Require status checks to pass
  - Select the CI/CD workflows you created

---

## Hostinger Setup & Deployment

### Step 1: Get Hostinger FTP Credentials

In **Hostinger Control Panel**:

1. Go to **Files** → **FTP Accounts**
2. Click "New FTP Account"
3. Create account:
   - Name: pulseinbox
   - Path: public_html (or /home/username/public_html)
   - Password: Generate strong password
4. Click "Create"

**Save these credentials:**
```
FTP Host: ftp.yourdomain.com
FTP User: pulseinbox@yourdomain.com
FTP Pass: [saved password]
```

### Step 2: Add to GitHub Secrets (Already Done)

Already added in "GitHub Setup" section:
- HOSTINGER_FTP_HOST
- HOSTINGER_FTP_USER
- HOSTINGER_FTP_PASS

### Step 3: Configure Hostinger Domain

In **Hostinger Control Panel** → **Domains**:

1. Click your domain
2. Go to **DNS Settings**
3. Verify A records point to Hostinger IP:
   ```
   @ → 1.2.3.4 (your Hostinger IP)
   www → 1.2.3.4
   ```

### Step 4: Enable SSL/HTTPS

In **Hostinger Control Panel** → **SSL/TLS**:

1. Click "Manage SSL"
2. Click "Issue Free SSL Certificate"
3. Select domain: yourdomain.com, www.yourdomain.com
4. Click "Issue"
5. Wait 5-10 minutes for issuance

### Step 5: Configure .htaccess for SPA Routing

In **Hostinger Control Panel** → **File Manager**:

1. Navigate to `/public_html/`
2. Create/edit `.htaccess`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  
  # Redirect to HTTPS
  RewriteCond %{HTTPS} off
  RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
  
  # SPA routing - redirect all requests to index.html
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### Step 6: Deploy Frontend Build

**Option A: Manual Deployment (Testing)**

```bash
# Build locally
npm run build

# Connect via FTP and upload dist/ folder
# Using FileZilla or similar:
# 1. Open FileZilla
# 2. Host: ftp://ftp.yourdomain.com
# 3. Username: pulseinbox@yourdomain.com
# 4. Password: [saved password]
# 5. Drag dist/ folder to public_html/
```

**Option B: Automatic Deployment (via GitHub Actions)**

```bash
# Push to main branch
git push origin main

# GitHub Actions automatically:
# 1. Builds the frontend
# 2. Uploads to Hostinger FTP
# 3. No manual steps needed
```

### Step 7: Test Hostinger Deployment

```bash
# Visit your domain
https://yourdomain.com

# Should load the PulseInbox app
# Check console for no errors
# Test login/signup
```

### Step 8: Configure Hostinger Email (Optional)

If you want transactional emails:

In **Hostinger Control Panel** → **Email**:

1. Create email account: noreply@yourdomain.com
2. Use SMTP credentials in app for sending emails

---

## Phase 3: Testing & CI/CD (TODO)

### Current Status: ⏳ Not Started

### Tasks to Complete:

#### 3.1 Set Up Jest Test Framework

```bash
# Install dependencies
npm install --save-dev @jest/globals jest @babel/preset-env @babel/preset-react jest-environment-jsdom

# Create jest.config.js
cat > jest.config.js << 'EOF'
export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
};
EOF

# Create .babelrc
cat > .babelrc << 'EOF'
{
  "presets": [["@babel/preset-env", { "targets": { "node": "current" } }], "@babel/preset-react"]
}
EOF

# Add to package.json scripts
npm set-script test "jest"
npm set-script test:watch "jest --watch"
npm set-script test:coverage "jest --coverage"
```

#### 3.2 Write Unit Tests for Critical Functions

Create test files:

```bash
mkdir -p src/components/__tests__
mkdir -p src/api/__tests__

# Test SendPulse integration
touch src/api/__tests__/sendMessage.test.js

# Test React components
touch src/components/__tests__/MessageThread.test.jsx
touch src/components/__tests__/TemplateSelect.test.jsx
touch src/components/__tests__/SendPulseBotsDialog.test.jsx
```

**Example test file** (src/api/__tests__/sendMessage.test.js):

```javascript
import { base44 } from '../base44Client';

describe('sendMessage', () => {
  it('should send a message successfully', async () => {
    const mockResponse = {
      data: {
        message_id: 'msg-123',
        status: 'pending',
      },
    };
    
    base44.functions.invoke = jest.fn().mockResolvedValue(mockResponse);
    
    const result = await base44.functions.invoke('sendMessage', {
      conversation_id: 'conv-123',
      text: 'Hello',
    });
    
    expect(result.data.message_id).toBe('msg-123');
  });

  it('should handle errors gracefully', async () => {
    base44.functions.invoke = jest.fn().mockRejectedValue(new Error('Network error'));
    
    await expect(
      base44.functions.invoke('sendMessage', {})
    ).rejects.toThrow('Network error');
  });
});
```

#### 3.3 Create Integration Tests

```bash
mkdir -p supabase/functions/__tests__

# Create integration test
touch supabase/functions/__tests__/sendMessage.integration.test.ts
```

**Example integration test** (supabase/functions/__tests__/sendMessage.integration.test.ts):

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const client = createClient(supabaseUrl, supabaseKey);

Deno.test("sendMessage integration test", async () => {
  const response = await client.functions.invoke("sendMessage", {
    body: {
      conversation_id: "test-conv-123",
      text: "Integration test message",
    },
  });

  assertEquals(response.status, 200);
});
```

#### 3.4 Set Up End-to-End Tests (E2E)

```bash
# Install Cypress or Playwright
npm install --save-dev @playwright/test
# or
npm install --save-dev cypress

# Create E2E tests
mkdir -p e2e
touch e2e/auth.spec.ts
touch e2e/messaging.spec.ts
```

**Example E2E test** (e2e/auth.spec.ts):

```typescript
import { test, expect } from '@playwright/test';

test('user can sign up and login', async ({ page }) => {
  await page.goto('http://localhost:5173');
  
  // Click sign up
  await page.click('text=Sign Up');
  
  // Fill form
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'TestPassword123');
  
  // Submit
  await page.click('button[type="submit"]');
  
  // Check for success
  await expect(page).toHaveURL('http://localhost:5173/dashboard');
});
```

#### 3.5 Configure CI/CD Pipeline for Tests

Update `.github/workflows/deploy-functions.yml` to include tests:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

### Deliverables for Phase 3:
- [ ] Jest configured and working
- [ ] Unit tests for 5+ critical functions
- [ ] Integration tests for 3+ functions
- [ ] E2E tests for user flows
- [ ] CI/CD tests running on GitHub Actions
- [ ] Coverage report > 80%

---

## Phase 4: Monitoring & Rollback (TODO)

### Current Status: ⏳ Not Started

### Tasks to Complete:

#### 4.1 Set Up Supabase Monitoring

```bash
# View function logs
supabase functions logs --project-ref your-project-id --tail 100

# Export logs for analysis
supabase functions logs --project-ref your-project-id > logs.txt
```

#### 4.2 Create Monitoring Dashboard

Create `supabase/monitoring/queries.sql`:

```sql
-- Query 1: Message throughput
SELECT 
  DATE(created_at) as date,
  COUNT(*) as message_count
FROM messages
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Query 2: Delivery success rate
SELECT 
  COUNT(CASE WHEN status = 'delivered' THEN 1 END)::float / 
  COUNT(*)::float * 100 as success_rate
FROM messages
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Query 3: Failed deliveries
SELECT 
  COUNT(*) as failed_count
FROM delivery_errors
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Query 4: Function performance
SELECT 
  function_name,
  COUNT(*) as calls,
  AVG(execution_ms) as avg_ms,
  MAX(execution_ms) as max_ms
FROM edge_function_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY function_name;
```

#### 4.3 Configure Alerting

Set up alerts for:

```
- Failed delivery rate > 5%
- Function execution time > 30s
- Auth token refresh failures > 3 in 1 hour
- Storage quota exceeded 90%
```

Use Supabase alerts or external services (PagerDuty, Datadog).

#### 4.4 Create Rollback Procedures

Create `ROLLBACK.md`:

```markdown
# Rollback Procedures

## Function Rollback
1. Identify problematic function
2. git log --oneline -- supabase/functions/[function-name]
3. git revert [commit-hash]
4. supabase functions deploy [function-name] --project-ref your-project-id

## Database Rollback
1. Supabase → Database → Backups
2. Select a backup from before the issue
3. Click "Restore"
4. Verify data integrity

## Frontend Rollback
1. Previous build archived in FTP server
2. Delete current build: rm -rf /public_html/*
3. Upload previous build
```

#### 4.5 Create Incident Response Runbook

Create `RUNBOOK.md`:

```markdown
# Incident Response Runbook

## Critical Issues

### Messages Not Sending
1. Check delivery_errors table
2. Review function logs
3. Verify SendPulse API key in global_config
4. Check processDeliveryQueue is running

### RLS Permission Errors
1. Verify user profile exists
2. Check auth.uid() matches profile.auth_uid
3. Review RLS policies

### High Latency
1. Check function execution time in logs
2. Review slow queries in database
3. Scale Supabase project if needed
```

### Deliverables for Phase 4:
- [ ] Monitoring queries created
- [ ] Alerts configured
- [ ] Rollback procedures documented
- [ ] Runbook created
- [ ] Support team trained

---

## Phase 5: Data Migration (TODO)

### Current Status: ⏳ Not Started

### Tasks to Complete:

#### 5.1 Execute Data Migration Script

```bash
# The template exists at: scripts/migrate-data.js
# Edit it with your Base44 data sources

# Export data from Base44
base44 export --format json > base44-data.json

# Run migration
node scripts/migrate-data.js ./base44-data.json

# Verify results
psql $SUPABASE_URL -c "SELECT COUNT(*) FROM messages;"
psql $SUPABASE_URL -c "SELECT COUNT(*) FROM conversations;"
```

#### 5.2 Validate Data Integrity

```sql
-- Check for orphaned records
SELECT COUNT(*) FROM messages m 
WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id);

-- Check all profiles have auth users
SELECT COUNT(*) FROM profiles p 
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.auth_uid);

-- Verify counts match source system
SELECT 
  'messages' as table_name, COUNT(*) FROM messages
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles;
```

#### 5.3 Backup Base44 Data

```bash
# Export all data from Base44
base44 export --format csv > base44-backup.csv
base44 export --format json > base44-backup.json

# Store in archive
tar -czf base44-backup-$(date +%Y%m%d).tar.gz base44-backup.*
s3cmd put base44-backup-*.tar.gz s3://your-backup-bucket/
```

### Deliverables for Phase 5:
- [ ] Data exported from Base44
- [ ] Migration script executed
- [ ] Data integrity validated
- [ ] Backup created and archived
- [ ] Migration report generated

---

## Phase 6: Production Release (TODO)

### Current Status: ⏳ Not Started

### Tasks to Complete:

#### 6.1 Schedule Maintenance Window

```bash
# Example: Saturday 2:00 AM - 4:00 AM UTC
# Announce to users: "Planned maintenance Saturday 2-4 AM UTC"
# Expected downtime: 30 minutes
```

#### 6.2 Pre-Release Checklist

```bash
# 1. Verify all tests pass
npm test -- --coverage
supabase functions list --project-ref your-project-id

# 2. Verify staging environment works
# Deploy to staging Supabase project first
# Run full E2E test suite

# 3. Brief support team
# Share runbook and escalation contacts

# 4. Prepare rollback plan
# Have previous build archived
# Have database backup ready
```

#### 6.3 Switch DNS (if necessary)

```bash
# If moving from Base44 domain to new domain:
# Update DNS A records to point to Hostinger IP
# Update CNAME for www subdomain

# Verify DNS propagation
nslookup yourdomain.com
dig yourdomain.com
```

#### 6.4 Enable New Services

```bash
# 1. Enable Supabase realtime (already done)
# 2. Enable storage bucket (already done)
# 3. Start GitHub Actions CI/CD
# 4. Start monitoring/alerting

git push origin main  # Triggers all automated deployments
```

#### 6.5 Monitor First 48 Hours

```bash
# Watch these metrics closely:
# - Function error rate (should be < 0.5%)
# - Message delivery success rate (should be > 99%)
# - User auth success rate (should be > 99%)
# - Page load times (should be < 2s)

supabase functions logs --project-ref your-project-id --tail 100 &
watch -n 5 'psql $SUPABASE_URL -c "SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '\''1 hour'\'';"'
```

### Deliverables for Phase 6:
- [ ] Maintenance window scheduled
- [ ] Pre-release checklist completed
- [ ] DNS configured
- [ ] Services enabled
- [ ] Monitoring active
- [ ] First 48 hours successful

---

## Phase 7: Decommission (TODO)

### Current Status: ⏳ Not Started

### Tasks to Complete:

#### 7.1 Archive Base44 Deployment

```bash
# 1. Stop Base44 functions
# 2. Export final data snapshot
# 3. Archive codebase
git clone [base44-repo] base44-archive
tar -czf base44-archive-final-$(date +%Y%m%d).tar.gz base44-archive/
s3cmd put base44-archive-final-*.tar.gz s3://your-archive-bucket/

# 4. Document lessons learned
cat > MIGRATION_LESSONS.md << 'EOF'
# Migration Lessons Learned

## What Went Well
- Edge Functions type safety prevented runtime errors
- RLS policies ensured data isolation
- Real-time subscriptions improved UX

## What Could Be Improved
- Testing should start earlier
- Staging environment should mirror production
- Team training on Supabase needed upfront

## Recommendations for Future Migrations
- Allocate more time for testing phase
- Create sandbox projects for learning
- Document all custom scripts early
EOF
```

#### 7.2 Cost Optimization

```bash
# Analyze Supabase billing
# - Function invocations cost
# - Storage usage
# - Database size
# - Bandwidth usage

# Optimize if needed:
# - Upgrade to higher tier if approaching limits
# - Remove unused functions
# - Archive old data
# - Implement caching strategies
```

#### 7.3 Knowledge Transfer

```bash
# Create final documentation:
# 1. Architecture diagram (draw.io)
# 2. Database schema documentation (dbdocs.io)
# 3. API documentation (Swagger/OpenAPI)
# 4. Troubleshooting guide
# 5. Support escalation procedures

# Hand off to ops team:
# - Slack channel: #pulseinbox-support
# - Documentation: Wiki/Confluence
# - On-call rotation: PagerDuty
# - Access: GitHub, Supabase, Hostinger
```

### Deliverables for Phase 7:
- [ ] Base44 archived
- [ ] Lessons learned documented
- [ ] Cost analysis completed
- [ ] Knowledge transferred to team
- [ ] Support handoff complete

---

## Complete Checklist

### Pre-Deployment (Supabase)

- [ ] Supabase project created
- [ ] Database schema migrated (`supabase db push`)
- [ ] All 13 Edge Functions deployed
- [ ] Storage bucket created (attachments)
- [ ] Storage policies configured
- [ ] Authentication configured
- [ ] Realtime enabled on messages table
- [ ] Global settings configured (app_base_url, etc.)
- [ ] Environment variables set

### Pre-Deployment (GitHub)

- [ ] Repository created and code pushed
- [ ] All secrets added to GitHub
- [ ] CI/CD workflow files created
- [ ] Deploy workflow tested (at least one successful run)
- [ ] Branch protection rules configured (optional)
- [ ] Collaborators added with appropriate permissions

### Pre-Deployment (Hostinger)

- [ ] FTP account created
- [ ] Domain configured
- [ ] SSL certificate installed
- [ ] .htaccess configured for SPA routing
- [ ] Static site deployed (build tested locally)
- [ ] HTTPS working
- [ ] Site accessible at yourdomain.com

### Testing Phase (Phase 3)

- [ ] Jest configured
- [ ] Unit tests written (5+ functions)
- [ ] Integration tests written
- [ ] E2E tests written
- [ ] All tests passing
- [ ] Coverage > 80%
- [ ] CI/CD tests running

### Monitoring & Rollback (Phase 4)

- [ ] Monitoring dashboard created
- [ ] Alerts configured
- [ ] Rollback procedures documented
- [ ] Runbook created
- [ ] Support team trained

### Data Migration (Phase 5)

- [ ] Data exported from Base44
- [ ] Migration script executed
- [ ] Data validated
- [ ] Backup created
- [ ] Archive stored

### Production Release (Phase 6)

- [ ] Maintenance window scheduled
- [ ] Pre-release checklist completed
- [ ] DNS configured (if necessary)
- [ ] Services enabled
- [ ] 48-hour monitoring completed

### Decommission (Phase 7)

- [ ] Base44 archived
- [ ] Lessons learned documented
- [ ] Cost optimization completed
- [ ] Knowledge transferred
- [ ] Support handoff complete

---

## Quick Reference

### Important Commands

```bash
# Supabase
supabase link --project-ref your-project-id
supabase db push
supabase functions deploy [function-name]
supabase functions logs --tail 100
supabase start

# GitHub
git push origin main
git branch -M main

# Testing
npm test
npm run test:coverage
npm run test:watch

# Building
npm run build

# Hosting
npm run dev
```

### Important Files

```
.env.local                                    # Local environment variables
.env.example                                  # Template for env vars
supabase/migrations/*.sql                     # Database migrations
supabase/functions/*/entry.ts                 # Edge Functions
src/api/base44Client.js                       # Supabase wrapper
.github/workflows/*.yml                       # CI/CD workflows
scripts/migrate-data.js                       # Data migration script
```

### Key URLs

```
Supabase Dashboard:    https://supabase.com/dashboard
GitHub Repository:     https://github.com/your-org/pulseinbox
Hostinger Control:     https://hpanel.hostinger.com
Production App:        https://yourdomain.com
```

### Support Contacts

```
Supabase Support:      https://supabase.com/docs or Discord
GitHub Support:        https://github.com/contact
Hostinger Support:     https://www.hostinger.com/support
Internal Support:      #pulseinbox-dev on Slack
```

---

## Next Steps for Future Sessions

When continuing this project in a new session:

1. **Check Status**: Review MIGRATION_STATUS.md for current phase
2. **Pick Next Task**: Choose from Phase 3/4/5/6/7 TODO sections above
3. **Review Checklist**: Use the phase-specific checklist
4. **Execute Steps**: Follow step-by-step guides in this document
5. **Update Status**: Mark tasks complete in relevant docs

Example next session:
```bash
# Session starts here
cd /workspaces/pulseinbox

# 1. Check what's done
cat MIGRATION_STATUS.md | grep -A 50 "Phase 3"

# 2. Start Phase 3: Testing
npm install --save-dev @jest/globals jest
# ... follow Phase 3 steps above

# 3. Update docs when complete
# Commit and push
git add .
git commit -m "feat: add jest testing framework"
git push origin main
```

---

**Document Version**: 1.0  
**Last Updated**: June 2026  
**Status**: Ready for Phase 3+

For the latest updates: See MIGRATION_STATUS.md or INDEX.md
