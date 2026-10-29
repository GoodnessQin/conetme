-- Buckets. Files are stored under {user_id}/... so policies can check the folder owner.
insert into storage.buckets (id, name, public) values
  ('verification', 'verification', false),     -- ID photos, selfies, documents: staff + owner only
  ('request-photos', 'request-photos', false),
  ('portfolio', 'portfolio', true),
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "owner uploads verification files" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner or staff read verification files" on storage.objects for select to authenticated
  using (bucket_id = 'verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

create policy "owner uploads request photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner or staff read request photos" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

create policy "owner uploads portfolio" on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner uploads avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
