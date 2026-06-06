# PulseInbox — Installation Guide

## What is PulseInbox?

PulseInbox is an omnichannel messaging platform that brings WhatsApp, Telegram, Instagram, Facebook, and Live Chat conversations into a single inbox. It connects to **SendPulse** for multi-channel messaging and **Bitrix24** for CRM workflows.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create a Supabase Project](#2-create-a-supabase-project)
3. [Deploy the Backend](#3-deploy-the-backend)
4. [Deploy the Frontend](#4-deploy-the-frontend)
5. [First Login and Initial Setup](#5-first-login-and-initial-setup)
6. [Connect SendPulse](#6-connect-sendpulse)
7. [Connect Bitrix24](#7-connect-bitrix24)
8. [Verify Everything Works](#8-verify-everything-works)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

Before you begin, make sure you have:

| Requirement | Notes |
|---|---|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Supabase CLI** | `npm install -g supabase` |
| **Supabase account** | Free tier works — [supabase.com](https://supabase.com) |
| **SendPulse account** | Required for multi-channel messaging |
| **Bitrix24 portal** | Optional, needed only for CRM integration |
| **A web hosting provider** | Any static host (Hostinger, Vercel, Netlify, etc.) |

---

## 2. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**, choose a name (e.g. `pulseinbox`), pick a region close to your users, and set a database password. Save this password — you'll need it.
3. Wait for the project to finish provisioning (~1 minute).
4. Go to **Settings → API** and copy:
   - **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
   - **anon / public key** — the `anon` JWT
   - **service_role key** — keep this secret, never expose it in the frontend

---

## 3. Deploy the Backend

### 3a. Clone the repository and install dependencies

```bash
git clone https://github.com/your-org/pulseinbox.git
cd pulseinbox
npm install
```

### 3b. Link to your Supabase project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with the ID shown in your Supabase dashboard URL  
(e.g. `https://supabase.com/dashboard/project/xxxxxxxxxxxx` → `xxxxxxxxxxxx`).

### 3c. Push the database schema

```bash
supabase db push
```

This applies all migrations and creates the following tables:

- `profiles` — user accounts
- `sendpulse_accounts` / `sendpulse_bots` — SendPulse integration
- `bitrix24_accounts` / `bitrix24_open_channels` — Bitrix24 integration
- `conversations` / `messages` / `attachments` — messaging data
- `delivery_queue` / `delivery_errors` — outbound message pipeline
- `global_config` — application-level settings

### 3d. Create the file storage bucket

In the Supabase dashboard, go to **Storage** and create a bucket named `attachments`. Set it to **Public** so message files can be served.

### 3e. Deploy Edge Functions

```bash
for func in supabase/functions/*/; do
  supabase functions deploy "$(basename $func)" --project-ref YOUR_PROJECT_ID
done
```

This deploys all 13 serverless functions that handle message delivery, webhooks, and CRM sync.

---

## 4. Deploy the Frontend

### 4a. Create the environment file

Create a file named `.env.local` in the project root:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_SUPABASE_STORAGE_BUCKET=attachments
```

Replace the values with what you copied from Supabase in step 2.

### 4b. Build the app

```bash
npm run build
```

This produces a `dist/` folder containing static files ready to upload.

### 4c. Upload to your hosting provider

Upload the entire contents of `dist/` to your web server's public directory (e.g. `public_html/`). The app is a single-page application — make sure your host is configured to redirect all routes to `index.html`.

**For Hostinger:** Use the File Manager or FTP to upload `dist/` to `public_html/`.

**For Vercel / Netlify:** Drag-and-drop `dist/` in the dashboard, or connect your GitHub repo for automatic deployments.

---

## 5. First Login and Initial Setup

### 5a. Register your admin account

1. Open your app URL in a browser.
2. Click **Register** and create your account with email and password.
3. Check your email for a confirmation link and click it.
4. Log in with your credentials.

### 5b. Configure global settings

1. In the app, go to **Settings**.
2. Set **App Base URL** to your production URL (e.g. `https://pulseinbox.yourdomain.com`).  
   This must be publicly reachable — it's used for webhook callbacks.
3. Save the settings.

---

## 6. Connect SendPulse

SendPulse provides the multi-channel messaging infrastructure (WhatsApp, Telegram, Instagram, Facebook, Live Chat).

### 6a. Get your SendPulse API credentials

1. Log into [sendpulse.com](https://sendpulse.com).
2. Go to **Account settings → API**.
3. Copy your **Client ID** and **Client Secret**.

### 6b. Connect from PulseInbox

1. In PulseInbox, go to **SendPulse Accounts**.
2. Click **Connect SendPulse**.
3. Complete the OAuth authorization flow — you'll be redirected to SendPulse to authorize access.
4. Once connected, click **Sync Bots** to import your chatbots and auto-register webhooks for each channel.

Your channels are now active. Incoming messages from WhatsApp, Telegram, Instagram, Facebook, and Live Chat will appear in **Dashboard → Conversations**.

---

## 7. Connect Bitrix24

Bitrix24 integration is optional. It lets your Bitrix24 agents receive and reply to messages inside Bitrix24's interface.

### 7a. Register PulseInbox as a Bitrix24 Marketplace app

1. Log into your Bitrix24 portal and go to **Developer Resources → Applications**.
2. Create a new application with the following webhook URLs:
   - **Handler URL**: `https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/bitrix24Handler`
   - **Installer URL**: `https://YOUR_SUPABASE_PROJECT.supabase.co/functions/v1/bitrix24Installer`
3. Set the required permissions: `im`, `imconnector`, `imopenlines`.
4. Copy the **App Client ID** and **App Client Secret**.

### 7b. Enter credentials in PulseInbox

1. In PulseInbox, go to **Settings**.
2. Enter your **Bitrix24 App Client ID** and **Bitrix24 App Client Secret**.
3. Save.

### 7c. Install the app on your Bitrix24 portal

1. Go to **Bitrix24 Accounts** in PulseInbox.
2. Click **Connect Bitrix24** and authorize the app on your Bitrix24 portal.
3. Once connected, click **Connect Reply Webhook** to enable two-way message sync.

### 7d. Link Open Channels

1. Go to **Open Channels** in PulseInbox.
2. Your Bitrix24 Open Lines will be listed. Select the channels you want to activate.

---

## 8. Verify Everything Works

Once installation is complete, run through this checklist:

- [ ] The app loads at your domain without errors
- [ ] You can log in with your admin account
- [ ] At least one SendPulse account is shown as connected in **SendPulse Accounts**
- [ ] The **Dashboard** loads and shows a conversations list (may be empty initially)
- [ ] Send a test message to your WhatsApp/Telegram bot — it should appear in the dashboard within seconds
- [ ] Reply from the dashboard — the message should be delivered to the sender
- [ ] (Bitrix24) Send a message to your portal's Open Line — it should appear in Bitrix24

---

## 9. Troubleshooting

### Messages are not arriving

- Confirm **App Base URL** in Settings matches your live domain exactly (no trailing slash, HTTPS).
- In SendPulse, go to **Account settings → API → Webhooks** and verify the webhook URLs are registered.
- Click **Sync Bots** again in SendPulse Accounts to re-register webhooks.

### Messages are not being sent

- Go to **Admin Queue** — check for failed deliveries and error messages.
- Verify your SendPulse token has not expired by disconnecting and reconnecting the account.
- Check the Supabase Edge Function logs:
  ```bash
  supabase functions logs sendMessage --tail 50
  ```

### Bitrix24 webhook is not triggering

- Confirm the Handler URL and Installer URL use your Supabase project's functions URL, not the app domain.
- In PulseInbox Settings, click **Connect Reply Webhook** again.
- Verify the app has the `im`, `imconnector`, and `imopenlines` permissions in the Bitrix24 marketplace.

### "Permission denied" errors in the app

- Sign out and sign back in to refresh your session token.
- If the error persists, check in Supabase that a row exists in the `profiles` table for your user.

### Build or deployment errors

```bash
# Clear caches and rebuild
rm -rf node_modules dist
npm install
npm run build
```

---

## Getting Help

If you run into an issue not covered here, check:

- Supabase function logs: **Supabase Dashboard → Edge Functions → Logs**
- Database errors: **Supabase Dashboard → Table Editor → delivery_errors**
- GitHub Issues: `https://github.com/your-org/pulseinbox/issues`
