# Deployment Checklist - PulseInbox Supabase Migration

Use this checklist to ensure all components are ready for deployment.

## Pre-Deployment Validation

### Code Quality
- [ ] All TypeScript files pass type checking: `deno check supabase/functions/*/entry.ts`
- [ ] No console errors in browser (check DevTools)
- [ ] All functions have proper error handling
- [ ] No hardcoded secrets or credentials
- [ ] All environment variables documented in .env.example

### Documentation
- [ ] README.md is up-to-date
- [ ] SETUP.md covers local development
- [ ] DEPLOYMENT.md has step-by-step instructions
- [ ] TESTING.md includes test procedures
- [ ] API Reference in supabase/functions/README.md
- [ ] Environment variables documented in SETUP.md

### Git & Version Control
- [ ] All changes committed to main branch
- [ ] Git tags created for release versions
- [ ] CHANGELOG updated with migration details
- [ ] README updated with Supabase references

### Dependencies
- [ ] npm packages up-to-date: `npm audit`
- [ ] No security vulnerabilities detected
- [ ] package-lock.json committed to git
- [ ] Development dependencies documented

## Supabase Project Setup

### Database
- [ ] Supabase project created at https://supabase.com
- [ ] All migrations applied: `supabase db push`
- [ ] Tables created: profiles, conversations, messages, etc.
- [ ] RLS policies enabled on all tables
- [ ] Indexes created for performance

### Authentication
- [ ] Email/password auth configured
- [ ] OAuth providers configured (if needed)
- [ ] JWT secret generated and stored safely
- [ ] Auth emails configured (optional)

### Storage
- [ ] attachments bucket created
- [ ] Storage policies configured
- [ ] Public/private access rules set
- [ ] CORS configured for domain

### Realtime
- [ ] Realtime enabled for public schema
- [ ] Replication set up for messages table
- [ ] Realtime subscriptions tested

## Edge Functions Setup

### Function Configuration
- [ ] All 13 functions created:
  - [ ] bitrix24Handler
  - [ ] bitrix24Installer
  - [ ] bitrix24ListLines
  - [ ] bitrix24BindReplyWebhook
  - [ ] bitrix24RegisterConnector
  - [ ] bitrix24PollReplies
  - [ ] sendMessage
  - [ ] getSendPulseTemplates
  - [ ] sendpulseSyncBots
  - [ ] sendpulseWebhook
  - [ ] adminGetDelivery
  - [ ] adminManageDelivery
  - [ ] processDeliveryQueue

### Function Testing
- [ ] Each function tested locally: `supabase functions serve`
- [ ] Function response format verified (matches frontend expectations)
- [ ] Error handling tested with invalid inputs
- [ ] Timeout/latency verified (< 30s)
- [ ] External API calls working (SendPulse, Bitrix24)

### Secrets & Environment
- [ ] SUPABASE_URL set in Supabase project
- [ ] SUPABASE_SERVICE_ROLE_KEY set (use service role key)
- [ ] External API keys stored in global_config table:
  - [ ] bitrix24_app_client_id
  - [ ] bitrix24_app_client_secret
  - [ ] app_base_url

## Frontend Setup

### Environment Variables
- [ ] .env.local created with Supabase credentials
- [ ] VITE_SUPABASE_URL set correctly
- [ ] VITE_SUPABASE_ANON_KEY set correctly
- [ ] VITE_SUPABASE_STORAGE_BUCKET set correctly

### Components Testing
- [ ] Login page works
- [ ] Sign up page works
- [ ] Message sending works
- [ ] Message receiving works (via Realtime)
- [ ] File upload works
- [ ] All pages load without errors

### Build & Optimization
- [ ] Build passes: `npm run build`
- [ ] No build errors or warnings
- [ ] Bundle size acceptable
- [ ] Tree shaking verified
- [ ] Code splitting configured

## GitHub Actions Setup

### Secrets Configuration
- [ ] SUPABASE_URL secret added
- [ ] SUPABASE_SERVICE_ROLE_KEY secret added
- [ ] SUPABASE_PROJECT_ID secret added
- [ ] SUPABASE_ACCESS_TOKEN secret added
- [ ] HOSTINGER_FTP_HOST secret added (if using FTP)
- [ ] HOSTINGER_FTP_USER secret added
- [ ] HOSTINGER_FTP_PASS secret added
- [ ] SLACK_WEBHOOK_URL secret added (optional)

### Workflows
- [ ] deploy-functions.yml created and tested
- [ ] Workflow triggers on push to main
- [ ] Functions deploy automatically
- [ ] Slack notifications working (if configured)

## External Integration Setup

### SendPulse
- [ ] OAuth app created
- [ ] Client ID and Secret obtained
- [ ] Redirect URI configured
- [ ] Test message sending via API
- [ ] Webhooks registered for all channels

### Bitrix24
- [ ] Marketplace app created
- [ ] App Client ID and Secret obtained
- [ ] Installation URL configured
- [ ] Handler URL configured
- [ ] Required permissions set (im, imconnector, imopenlines)
- [ ] Test portal installation

## Hosting Setup

### Hostinger
- [ ] FTP credentials obtained
- [ ] FTP access verified
- [ ] public_html directory accessible
- [ ] DNS pointing to Hostinger (if necessary)

### Frontend Deployment
- [ ] npm run build creates dist/ directory
- [ ] GitHub Actions uploads dist/ to Hostinger
- [ ] Website accessible at production URL
- [ ] HTTPS configured

### Domain & SSL
- [ ] Domain configured
- [ ] SSL certificate installed
- [ ] HTTPS working
- [ ] Redirect from HTTP to HTTPS

## Data Validation

### Database
- [ ] Sample user created and logged in
- [ ] Profile record exists in profiles table
- [ ] RLS working (user only sees own data)

### Messages
- [ ] Test message created
- [ ] Message appears in messages table
- [ ] Message appears in delivery_queue
- [ ] Realtime subscription fires

### File Attachments
- [ ] Test file uploaded
- [ ] File stored in attachments bucket
- [ ] File URL generated correctly
- [ ] File accessible via HTTP

## Integration Testing

### SendPulse Integration
- [ ] SendPulse account connected via OAuth
- [ ] Bots synced successfully
- [ ] Templates loaded
- [ ] Message sent to WhatsApp/Telegram
- [ ] Incoming message received via webhook

### Bitrix24 Integration
- [ ] App installed on test portal
- [ ] Account created in database
- [ ] Open Line listed in UI
- [ ] Connector registered
- [ ] Reply webhook connected
- [ ] Incoming message from Bitrix24 received
- [ ] Agent reply appears in inbox

## Performance Testing

### Function Performance
- [ ] sendMessage: < 500ms
- [ ] processDeliveryQueue: < 60s
- [ ] bitrix24Handler: < 2s
- [ ] sendpulseWebhook: < 2s

### Database Performance
- [ ] Message queries: < 100ms
- [ ] Conversation list: < 200ms
- [ ] Delivery queue query: < 500ms

### Frontend Performance
- [ ] Page load: < 2s
- [ ] Message send: < 1s feedback
- [ ] Message receive: < 500ms display

## Security Audit

### Secrets Management
- [ ] No secrets in git history
- [ ] .env.local in .gitignore
- [ ] GitHub secrets masked in logs
- [ ] Service role key never exposed to client

### Data Access
- [ ] RLS policies prevent unauthorized access
- [ ] Service role key only used server-side
- [ ] Anon key restricted to safe operations
- [ ] CORS configured properly

### API Security
- [ ] OAuth tokens refreshed before expiry
- [ ] Token storage encrypted
- [ ] Webhook payloads validated
- [ ] Rate limiting implemented

## Monitoring & Alerting

### Logging
- [ ] Function logs visible in Supabase dashboard
- [ ] Error logging configured
- [ ] Performance metrics collected

### Alerts
- [ ] Failed delivery alerts configured
- [ ] Function error rate alerts
- [ ] Storage quota alerts
- [ ] Token refresh failure alerts

### Dashboard
- [ ] Admin queue dashboard working
- [ ] Delivery status visible
- [ ] Error logs displayed
- [ ] Metrics accessible

## Backup & Disaster Recovery

### Database Backups
- [ ] Supabase automated backups enabled
- [ ] Backup retention configured (24+ hours)
- [ ] Manual backup procedure documented
- [ ] Restore procedure tested

### Code Backup
- [ ] All code in GitHub
- [ ] Git history preserved
- [ ] Tags created for releases
- [ ] Releases documented

### Data Export
- [ ] Base44 data exported (CSV/JSON)
- [ ] Data migration script created (scripts/migrate-data.js)
- [ ] Export verified for integrity
- [ ] Archive stored safely

## Rollback Plan

### Functions
- [ ] Previous function versions identified
- [ ] Rollback procedure documented
- [ ] `git revert` tested locally
- [ ] Emergency contact list created

### Database
- [ ] Rollback SQL scripts prepared
- [ ] Point-in-time recovery verified
- [ ] Data corruption recovery procedure

### Frontend
- [ ] Previous build archived
- [ ] Rollback to previous version possible
- [ ] FTP rollback procedure documented

## Communication & Training

### Team Communication
- [ ] Team notified of deployment date/time
- [ ] Support team briefed
- [ ] Runbook shared
- [ ] Escalation procedures defined

### User Communication
- [ ] Users notified of planned maintenance
- [ ] Maintenance window communicated
- [ ] Expected downtime shared
- [ ] Support contact info provided

### Documentation
- [ ] All docs updated to post-migration state
- [ ] API references point to new functions
- [ ] Troubleshooting updated
- [ ] FAQ created

## Post-Deployment Validation

### Immediate (< 1 hour)
- [ ] All services accessible
- [ ] No HTTP errors in browser console
- [ ] Function logs show successful execution
- [ ] No spike in error rates

### Short-term (24 hours)
- [ ] Users can send/receive messages
- [ ] Webhooks firing correctly
- [ ] Queue processing working
- [ ] Performance metrics stable

### Medium-term (7 days)
- [ ] No data integrity issues
- [ ] Error rate < 0.5%
- [ ] Performance metrics within SLA
- [ ] User feedback positive

## Decommission (After validation)

### Base44 Shutdown
- [ ] Data migrated successfully
- [ ] Base44 service backed up
- [ ] Base44 app archived
- [ ] Dependencies removed

### Cost Optimization
- [ ] Supabase plan optimized
- [ ] Unused resources removed
- [ ] Cost analysis reviewed

---

## Sign-Off Template

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Validated By**: _______________  
**Approved By**: _______________  

**Pre-deployment checklist**: ✅ Complete  
**Supabase setup**: ✅ Complete  
**Functions deployed**: ✅ Complete  
**Frontend deployed**: ✅ Complete  
**Integrations tested**: ✅ Complete  
**Post-deployment validation**: ✅ Complete  

**Status**: Ready for Production ✅

---

## Quick Reference Commands

```bash
# Type check functions
deno check supabase/functions/*/entry.ts

# Deploy all functions
for func in bitrix24Handler bitrix24Installer sendMessage sendpulseSyncBots getSendPulseTemplates; do
  supabase functions deploy $func --project-ref $SUPABASE_PROJECT_ID
done

# View logs
supabase functions logs --project-ref $SUPABASE_PROJECT_ID --tail 100

# Test locally
supabase start
supabase functions serve

# Database operations
supabase db push
supabase db pull
psql $SUPABASE_URL

# Frontend build & deploy
npm run build
# GitHub Actions will deploy to Hostinger
```

---

**Use this checklist before each deployment phase. Check items off as completed.**

For detailed procedures, refer to:
- Setup: [SETUP.md](./SETUP.md)
- Deployment: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Testing: [TESTING.md](./TESTING.md)
