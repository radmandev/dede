Supabase Storage and attachments

Bucket setup
- Create a bucket named `attachments` (public or private depending on your access model).
- For public delivery links use a public bucket or generate signed URLs for private buckets.

Policies
- If using a public bucket, set appropriate CORS and security rules.
- If using a private bucket, generate signed URLs in Edge Functions using the service role key.

Attachment migration
1. If you have existing external links, use `supabase/functions/lib/storage.ts`'s `uploadRemoteAttachment` helper to copy files into the `attachments` bucket and insert metadata rows.
2. The helper returns an `attachments` table row with `storage_path` and `url` (public URL via Supabase Storage).

Using attachments in functions
- The `sendMessage` and `sendpulseWebhook` functions call `uploadRemoteAttachment` for external links and then store metadata in the `attachments` table.

Notes
- Large files: for very large files (>50MB) prefer server-side streaming or chunked upload methods.
- Cleanup: create a retention/GC policy for attachments if needed and avoid unbounded storage growth.
