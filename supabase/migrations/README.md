Supabase migrations and data migration notes

Files in this folder:

- `001_create_core_tables.sql` — creates core tables (profiles, conversations, messages, accounts, attachments, templates, config, webhook_logs).
- `002_indexes_and_rls.sql` — creates indexes and example Row-Level Security (RLS) policies. Review and tighten policies for your app.

Applying migrations

1. Install the Supabase CLI: https://supabase.com/docs/guides/cli
2. Authenticate and point to your project, or use `supabase login`.
3. From repository root run:

```bash
supabase db remote set $SUPABASE_DB_URL   # optional: set remote DB URL
supabase db push --project-ref gxhiabxjvzmumxxmsnhy
```

Alternatively, run the SQL files directly in the SQL editor of the Supabase dashboard.

Data migration script

Use `scripts/migrate_data.js` to import JSON exports into Supabase. Example:

```bash
export SUPABASE_URL=https://gxhiabxjvzmumxxmsnhy.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
node scripts/migrate_data.js ./data/export.json
```

Notes & next steps
- Review and adapt RLS policies to match your ownership model (owner_id, team-based access, etc.).
- Add migrations to create foreign keys and tighter constraints once data shape is finalized.
- Encrypt or secure sensitive fields (client_secret, access_token) using Supabase Secrets or encrypted columns where required.
