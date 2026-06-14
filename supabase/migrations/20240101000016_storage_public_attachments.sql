-- Make the attachments bucket publicly readable so external services
-- (SendPulse, WhatsApp CDN) can download media without auth tokens.
UPDATE storage.buckets SET public = true WHERE id = 'attachments';

-- Ensure a public select policy exists (belt-and-suspenders for RLS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'attachments_public_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY attachments_public_read ON storage.objects
      FOR SELECT USING (bucket_id = 'attachments')
    $policy$;
  END IF;
END $$;
