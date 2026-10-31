insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No browser storage policies. The protected avatar endpoint proxies private objects.
