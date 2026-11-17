-- Locations: states and areas that admins can launch one at a time.
drop function if exists public.list_areas();
create or replace function public.list_areas() returns table(id uuid, name text, city text, state text, lat double precision, lng double precision)
language sql stable set search_path = public, extensions as $$
  select a.id, a.name, a.city, a.state, st_y(a.location::geometry), st_x(a.location::geometry)
  from public.areas a where a.active order by a.state, a.city, a.name
$$;
grant execute on function public.list_areas() to anon, authenticated;

create or replace function public.admin_areas() returns table(id uuid, name text, city text, state text, lat double precision, lng double precision, active boolean, providers bigint)
language sql stable security definer set search_path = public, extensions as $$
  select a.id, a.name, a.city, a.state, st_y(a.location::geometry), st_x(a.location::geometry), a.active,
         (select count(*) from public.providers p where p.base_area_id = a.id and p.status = 'approved')
  from public.areas a where public.is_admin() order by a.state, a.city, a.name
$$;

create or replace function public.admin_upsert_area(p_id uuid, p_state text, p_city text, p_name text, p_lat double precision, p_lng double precision, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare rid uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can change locations.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_state,''))) < 2 or length(trim(coalesce(p_city,''))) < 2 or length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'Enter the state, city and area name.'; end if;
  if p_lat is null or p_lng is null or p_lat not between 4 and 14 or p_lng not between 2.5 and 15 then
    raise exception 'The pin must be inside Nigeria.'; end if;
  if exists (select 1 from public.areas where lower(city) = lower(trim(p_city)) and lower(name) = lower(trim(p_name)) and id is distinct from p_id) then
    raise exception 'This area already exists in %.', trim(p_city); end if;
  if p_id is null then
    insert into public.areas (name, city, state, location, active)
    values (trim(p_name), trim(p_city), trim(p_state), st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, coalesce(p_active, true)) returning id into rid;
  else
    update public.areas set name = trim(p_name), city = trim(p_city), state = trim(p_state),
      location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, active = coalesce(p_active, active) where id = p_id returning id into rid;
    if rid is null then raise exception 'Area not found.'; end if;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, after) values (auth.uid(), 'area_saved', 'areas', rid, jsonb_build_object('name', p_name, 'state', p_state, 'active', p_active));
  return rid;
end $$;

create or replace function public.admin_set_state_active(p_state text, p_active boolean) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only admins can change locations.' using errcode = '42501'; end if;
  update public.areas set active = p_active where state = p_state;
  get diagnostics n = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, after) values (auth.uid(), case when p_active then 'state_launched' else 'state_hidden' end, 'areas', null, jsonb_build_object('state', p_state, 'areas', n));
  return n;
end $$;

insert into public.areas (name, city, state, location, active) values
('GRA Phase 2','Port Harcourt','Rivers', st_geogfromtext('SRID=4326;POINT(7.0134 4.8156)'), false),
('Rumuola','Port Harcourt','Rivers', st_geogfromtext('SRID=4326;POINT(7.0200 4.8400)'), false),
('Bodija','Ibadan','Oyo', st_geogfromtext('SRID=4326;POINT(3.9100 7.4350)'), false),
('Ring Road','Ibadan','Oyo', st_geogfromtext('SRID=4326;POINT(3.8800 7.3700)'), false)
on conflict (city, name) do nothing;
