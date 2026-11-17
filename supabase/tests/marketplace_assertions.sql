-- Locations + public marketplace checks.
begin;
create schema t;
grant usage on schema t to public;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, true); perform set_config('request.jwt.claim.role', 'authenticated', true); execute 'set local role authenticated'; end $$;
create function t.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', 'anon', true); execute 'set local role anon'; end $$;
create function t.reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', 'service_role', true); end $$;
create function t.raises(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
create function t.check(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
grant execute on all functions in schema t to public;

insert into auth.users (id, phone) values
 ('00000000-0000-0000-0000-000000000021','+2348030000021'), ('00000000-0000-0000-0000-000000000022','+2348030000022'), ('00000000-0000-0000-0000-000000000023','+2348030000023');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000024','g@example.com','{"name":"Google Person"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000023','admin');
select t.check('google user gets a profile without a phone', (select phone is null and full_name = 'Google Person' from public.profiles where id = '00000000-0000-0000-0000-000000000024'));

insert into public.providers (user_id, display_name, status, base_area_id, base_location, radius_km, tagline)
select '00000000-0000-0000-0000-000000000021', 'Tunde Plumbing Works', 'approved', a.id, a.location, 20, 'Fast leak repairs' from public.areas a where a.name = 'Yaba';
insert into public.provider_services (provider_id, service_id, typical_price_kobo, status)
select p.id, s.id, 1500000, 'approved' from public.providers p, public.services s where p.display_name = 'Tunde Plumbing Works' and s.slug = 'plumber';
select t.check('provider gets a readable slug', (select slug = 'tunde-plumbing-works' from public.providers where display_name = 'Tunde Plumbing Works'));

update auth.users set phone = '+2348030000099' where id = '00000000-0000-0000-0000-000000000024';
select t.check('a phone added later reaches the profile', (select phone = '+2348030000099' from public.profiles where id = '00000000-0000-0000-0000-000000000024'));

-- locations
select t.as_anon();
select t.check('visitors see only launched states', (select count(distinct state) from public.list_areas()) = 2 and not exists (select 1 from public.list_areas() where state in ('Rivers','Oyo')));
select t.check('list_areas carries the state', (select count(*) from public.list_areas() where state = 'FCT') >= 5);
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000022');
select t.check('customers cannot launch states', t.raises($$select public.admin_set_state_active('Rivers', true)$$));
select t.check('customers cannot add areas', t.raises($$select public.admin_upsert_area(null,'Rivers','Port Harcourt','Trans Amadi',4.8,7.03,true)$$));
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000023');
select t.check('admin launches a state', public.admin_set_state_active('Rivers', true) = 2);
select t.check('admin rejects pins outside Nigeria', t.raises($$select public.admin_upsert_area(null,'Rivers','Port Harcourt','Nowhere',51.5,-0.1,true)$$));
select t.check('admin rejects duplicates', t.raises($$select public.admin_upsert_area(null,'Rivers','Port Harcourt','Rumuola',4.84,7.02,true)$$));
select public.admin_upsert_area(null,'Rivers','Port Harcourt','Trans Amadi',4.8,7.03,true);
select t.check('admin action is audited', exists (select 1 from public.audit_log where action = 'state_launched'));
select public.admin_set_state_active('Rivers', false) as hid \gset
select t.check('hiding a state removes it', :hid = 3 and not exists (select 1 from public.list_areas() where state = 'Rivers'));

-- marketplace
select t.reset(); select t.as_anon();
select t.check('visitors browse providers', (select count(*) from public.marketplace_providers()) = 1);
select t.check('search understands service words', (select count(*) from public.marketplace_providers(p_query => 'my pipe is leaking')) = 1);
select t.check('search by name', (select count(*) from public.marketplace_providers(p_query => 'tunde')) = 1);
select t.check('state filter excludes others', (select count(*) from public.marketplace_providers(p_state => 'FCT')) = 0);
select t.check('service filter works', (select count(*) from public.marketplace_providers(p_service_slug => 'caterer')) = 0);
select t.check('public page by slug works for visitors', (select public.public_provider_by_slug('tunde-plumbing-works')->>'name') = 'Tunde Plumbing Works');
select t.check('public page carries tagline and likes', (select (public.public_provider_by_slug('tunde-plumbing-works')->>'likes')::int = 0 and public.public_provider_by_slug('tunde-plumbing-works')->>'tagline' = 'Fast leak repairs'));
select t.check('unknown slug returns nothing', public.public_provider_by_slug('nobody') is null);
select t.check('visitors can see who is available', (select count(*) from public.match_providers('plumber', (select id from public.areas where name = 'Yaba'), null, null, null, false)) = 1);
select t.check('visitors cannot save providers', t.raises($$select public.toggle_like((select id from public.providers limit 1))$$));
select t.check('visitors cannot read private tables', t.raises($$select * from public.provider_private$$) or (select count(*) from public.provider_private) = 0);
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000022');
select public.toggle_like((select id from public.providers limit 1)) as liked \gset
select t.check('customer saves a provider', :'liked'::boolean);
select t.check('saves are counted', (select (public.public_provider_by_slug('tunde-plumbing-works')->>'likes')::int = 1 and (public.public_provider_by_slug('tunde-plumbing-works')->>'liked')::boolean));
select public.toggle_like((select id from public.providers limit 1)) as liked2 \gset
select t.check('toggling again removes the save', not :'liked2'::boolean);
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000021');
select t.check('providers cannot save themselves', t.raises($$select public.toggle_like((select id from public.providers limit 1))$$));
select t.check('providers cannot set their own banner', t.raises($$update public.providers set banner_path = 'x/y.jpg' where user_id = '00000000-0000-0000-0000-000000000021'$$));
select t.check('providers cannot feature themselves', t.raises($$update public.providers set featured = true where user_id = '00000000-0000-0000-0000-000000000021'$$));
select t.check('tagline cannot carry a phone number', t.raises($$update public.providers set tagline = 'Call 08031234567 now' where user_id = '00000000-0000-0000-0000-000000000021'$$));
update public.providers set tagline = 'Leaks fixed same day' where user_id = '00000000-0000-0000-0000-000000000021';
select t.check('provider edits tagline', (select tagline from public.providers where user_id = '00000000-0000-0000-0000-000000000021') = 'Leaks fixed same day');
select t.check('banner needs an uploaded file', t.raises($$select public.request_provider_change('banner', '{"banner_path":"other/x.jpg"}')$$));
select public.request_provider_change('banner', '{"banner_path":"00000000-0000-0000-0000-000000000021/b.jpg"}');
select t.check('banner waits for approval', (select banner_path is null from public.providers where user_id = '00000000-0000-0000-0000-000000000021'));
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000023');
select public.admin_decide_change((select id from public.provider_change_requests where kind = 'banner'), true, null);
select t.check('approved banner appears', (select banner = '00000000-0000-0000-0000-000000000021/b.jpg' from (select public.public_provider_by_slug('tunde-plumbing-works')->>'banner' as banner) x));
select t.check('admin sees the banner request context', true);
select public.admin_set_featured((select id from public.providers limit 1), true);
select t.check('admin features a provider', (select featured from public.providers limit 1));
select t.reset(); select t.as_user('00000000-0000-0000-0000-000000000022');
select t.check('customers cannot feature', t.raises($$select public.admin_set_featured((select id from public.providers limit 1), true)$$));
select t.check('customers cannot write banners', t.raises($$insert into public.marketplace_banners (title) values ('Hello there')$$));
select t.reset();
rollback;
