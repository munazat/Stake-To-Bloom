-- 20261109000300_storage.sql — private `proofs` bucket + per-user folder policies (§7.3, §9).
--
-- Proof images are PRIVATE. The browser downscales + re-encodes to JPEG (~150-300 KB,
-- EXIF/GPS stripped) and uploads to:  proofs/<userId>/<pactId>/<dayIndex>-<uuid>.jpg
-- storage.objects.name is the path within the bucket, so foldername(name)[1] = userId.
-- A signed-in user may write/read ONLY inside their own folder. Edge Functions use
-- service_role, which bypasses storage RLS to fetch images for the AI referee.

-- 2.5 MB cap; JPEG only (the client re-encodes). The magic-byte check happens in the
-- submit-proof Edge Function (Phase 6), not here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 2621440, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy proofs_upload_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy proofs_read_own_folder on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE/DELETE policies for clients: a user cannot overwrite or remove a proof
-- once uploaded (the append-only audit trail). Service role still can, if ever needed.
