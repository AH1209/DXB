-- Run once in a new Supabase project. All application data is server-only.
create table public.contacts (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
 country text not null check(length(country)=2), city text not null default '', timezone text not null,
 age integer check(age between 1 and 120), description text not null default '', enabled boolean not null default true,
 avatar_path text, last_activity timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.app_settings (id boolean primary key default true check(id), preferences jsonb not null default '{}');
insert into public.app_settings default values;
create table public.auth_sessions (token_hash text primary key, expires_at timestamptz not null, created_at timestamptz not null default now());
create table public.rate_limits (key text primary key, window_start timestamptz not null default now(), attempts integer not null default 1);
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), device_id uuid not null unique,
 endpoint text unique not null, keys jsonb not null, status text not null default 'active' check(status in ('active','expired','disabled')),
 created_at timestamptz not null default now(), last_success timestamptz);
create table public.sessions (id uuid primary key default gen_random_uuid(), request_id uuid unique not null,
 status text not null default 'active' check(status in ('active','stopped','completed')), starts_at timestamptz not null,
 ends_at timestamptz not null, config jsonb not null, stopped_at timestamptz, created_at timestamptz not null default now(),
 check(ends_at > starts_at and ends_at <= starts_at + interval '9 hours'));
create unique index one_active_session on public.sessions ((true)) where status='active';
create table public.notification_events (id uuid primary key default gen_random_uuid(), session_id uuid references public.sessions on delete cascade,
 sender_id uuid references public.contacts on delete cascade, reply_id uuid references public.contacts on delete set null,
 kind text not null check(kind in ('message','image','reply','test')), scheduled_at timestamptz not null,
 created_at timestamptz not null default now(), check(kind='test' or (session_id is not null and sender_id is not null)));
create table public.deliveries (id uuid primary key default gen_random_uuid(), event_id uuid not null references public.notification_events on delete cascade,
 subscription_id uuid not null references public.push_subscriptions on delete cascade,
 status text not null default 'pending' check(status in ('pending','claimed','sending','submitted','failed','cancelled','unknown')),
 attempts integer not null default 0, available_at timestamptz not null, lease_until timestamptz, claim_token uuid,
 submitted_at timestamptz, error text, unique(event_id,subscription_id));
create index deliveries_due on public.deliveries(available_at) where status='pending';
create index deliveries_event on public.deliveries(event_id);
create index events_session on public.notification_events(session_id);
create index events_sender on public.notification_events(sender_id);

create function public.dxb_now() returns timestamptz language sql stable as $$ select now() $$;
create function public.dxb_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql as $$
declare n integer; begin
 insert into public.rate_limits(key) values(p_key) on conflict(key) do update set
 attempts=case when rate_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else rate_limits.attempts+1 end,
 window_start=case when rate_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else rate_limits.window_start end returning attempts into n;
 return n<=p_limit;
end $$;
create function public.dxb_expire() returns void language plpgsql as $$ begin
 update public.sessions set status='completed' where status='active' and ends_at<=now();
 update public.deliveries d set status='cancelled',error='Session ended' from public.notification_events e join public.sessions s on s.id=e.session_id
 where d.event_id=e.id and s.status<>'active' and d.status in ('pending','claimed');
 -- A crashed in-flight network request is ambiguous. Never resend it automatically.
 update public.deliveries set status='unknown',error='Worker interrupted during send; acceptance unknown' where status='sending' and lease_until<now();
 update public.deliveries set status='pending',claim_token=null where status='claimed' and lease_until<now();
 update public.deliveries set status='failed',error='Missed delivery window' where status='pending' and available_at<now()-interval '5 minutes';
 delete from public.auth_sessions where expires_at<now();
 delete from public.rate_limits where window_start<now()-interval '2 days';
 -- Retain activity metadata on contacts, but bound operational history.
 delete from public.notification_events where created_at<now()-interval '30 days';
 delete from public.sessions where created_at<now()-interval '30 days' and status<>'active';
end $$;
create function public.dxb_start(p_request uuid,p_config jsonb,p_events jsonb,p_start timestamptz) returns uuid language plpgsql as $$
declare sid uuid; begin
 perform pg_advisory_xact_lock(1509001); perform public.dxb_expire();
 select id into sid from public.sessions where request_id=p_request; if sid is not null then return sid; end if;
 if exists(select 1 from public.sessions where status='active') then raise exception 'DXB:A session is already active'; end if;
 if abs(extract(epoch from(now()-p_start)))>120 then raise exception 'DXB:Schedule creation took too long. Try again'; end if;
 if not exists(select 1 from public.push_subscriptions where status='active') then raise exception 'DXB:Enable notifications on a device first'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_config->'selected') v where not exists(select 1 from public.contacts c where c.id=v::uuid and c.enabled)) then raise exception 'DXB:A selected contact is missing or disabled'; end if;
 insert into public.sessions(request_id,starts_at,ends_at,config) values(p_request,p_start,p_start+make_interval(hours=>(p_config->>'duration')::integer),p_config) returning id into sid;
 insert into public.notification_events(session_id,sender_id,reply_id,kind,scheduled_at)
 select sid,x.sender_id,x.reply_id,x.kind,x.scheduled_at from jsonb_to_recordset(p_events) as x(sender_id uuid,reply_id uuid,kind text,scheduled_at timestamptz);
 insert into public.deliveries(event_id,subscription_id,available_at) select e.id,s.id,e.scheduled_at from public.notification_events e cross join public.push_subscriptions s where e.session_id=sid and s.status='active';
 return sid;
end $$;
create function public.dxb_stop() returns void language plpgsql as $$ begin
 perform pg_advisory_xact_lock(1509001);
 update public.sessions set status='stopped',stopped_at=now() where status='active';
 update public.deliveries set status='cancelled',error='Stopped by user' where status in ('pending','claimed');
end $$;
create function public.dxb_claim(p_limit integer default 40) returns setof public.deliveries language plpgsql as $$ begin
 perform public.dxb_expire();
 return query with due as (select d.id from public.deliveries d join public.notification_events e on e.id=d.event_id
 left join public.sessions s on s.id=e.session_id join public.push_subscriptions p on p.id=d.subscription_id
 where d.status='pending' and d.available_at<=now() and p.status='active' and (e.kind='test' or(s.status='active' and s.ends_at>now()))
 order by d.available_at for update of d skip locked limit least(p_limit,40))
 update public.deliveries d set status='claimed',claim_token=gen_random_uuid(),lease_until=now()+interval '90 seconds' from due where d.id=due.id returning d.*;
end $$;
create function public.dxb_begin_send(p_id uuid,p_token uuid) returns boolean language plpgsql as $$
declare n integer;begin
 -- Serialize dispatch authorization with stop/edit/delete operations.
 perform pg_advisory_xact_lock(1509001);
 update public.deliveries d set status='sending',attempts=attempts+1,lease_until=now()+interval '90 seconds'
 from public.notification_events e left join public.sessions s on e.session_id=s.id
 where d.id=p_id and d.claim_token=p_token and d.status='claimed' and d.lease_until>now() and d.event_id=e.id
 and (e.kind='test' or(s.status='active' and s.ends_at>now()))
 and exists(select 1 from public.push_subscriptions p where p.id=d.subscription_id and p.status='active');
 get diagnostics n=row_count;return n=1;
end $$;
create function public.dxb_finish(p_id uuid,p_token uuid,p_status text,p_error text default null) returns void language plpgsql as $$
declare item public.deliveries;begin
 select * into item from public.deliveries where id=p_id and claim_token=p_token and status='sending' for update;
 if not found then return; end if;
 update public.deliveries set status=case when p_status='retry' and attempts<3 then 'pending' when p_status='retry' then 'failed' else p_status end,
 available_at=now()+make_interval(secs=>30*power(2,attempts)::integer),submitted_at=case when p_status='submitted' then now() else null end,error=left(p_error,500),claim_token=null where id=p_id;
 if p_status='submitted' then
 update public.push_subscriptions set last_success=now() where id=item.subscription_id;
 update public.contacts set last_activity=now() where id=(select sender_id from public.notification_events where id=item.event_id);
 end if;
end $$;
create function public.dxb_save_contact(p_id uuid,p_data jsonb) returns uuid language plpgsql as $$
declare cid uuid;begin
 perform pg_advisory_xact_lock(1509001);perform public.dxb_expire();
 if p_id is not null and exists(select 1 from public.sessions where status='active') then raise exception 'DXB:Stop the active session before editing contacts';end if;
 if p_id is null then
 insert into public.contacts(name,country,city,timezone,age,description,enabled) values(p_data->>'name',p_data->>'country',p_data->>'city',p_data->>'timezone',(p_data->>'age')::integer,p_data->>'description',(p_data->>'enabled')::boolean) returning id into cid;
 else update public.contacts set name=p_data->>'name',country=p_data->>'country',city=p_data->>'city',timezone=p_data->>'timezone',age=(p_data->>'age')::integer,description=p_data->>'description',enabled=(p_data->>'enabled')::boolean,updated_at=now() where id=p_id returning id into cid;end if;
 return cid;
end $$;
create function public.dxb_delete_contact(p_id uuid) returns text language plpgsql as $$
declare path text;begin perform pg_advisory_xact_lock(1509001);select avatar_path into path from public.contacts where id=p_id;delete from public.contacts where id=p_id;return path;end $$;
create function public.dxb_test(p_device uuid,p_delay integer) returns uuid language plpgsql as $$
declare eid uuid;sid uuid;begin
 select id into sid from public.push_subscriptions where device_id=p_device and status='active';if sid is null then raise exception 'DXB:This device has no active subscription';end if;
 insert into public.notification_events(kind,scheduled_at) values('test',now()+make_interval(secs=>p_delay)) returning id into eid;
 insert into public.deliveries(event_id,subscription_id,available_at) values(eid,sid,now()+make_interval(secs=>p_delay));return eid;
end $$;
create function public.dxb_session_status() returns jsonb language sql stable as $$
 select to_jsonb(s)||jsonb_build_object('planned',(select count(*) from public.notification_events where session_id=s.id),
 'submitted',(select count(distinct d.event_id) from public.deliveries d join public.notification_events e on e.id=d.event_id where e.session_id=s.id and d.status='submitted'),
 'failed',(select count(*) from public.deliveries d join public.notification_events e on e.id=d.event_id where e.session_id=s.id and d.status in('failed','unknown')),
 'pending',(select count(*) from public.deliveries d join public.notification_events e on e.id=d.event_id where e.session_id=s.id and d.status in('pending','claimed','sending')),
 'cancelled',(select count(*) from public.deliveries d join public.notification_events e on e.id=d.event_id where e.session_id=s.id and d.status='cancelled'))
 from public.sessions s order by created_at desc limit 1
$$;

-- RLS has no browser policies: only the service role can access application tables.
do $$ declare t text;begin foreach t in array array['contacts','app_settings','auth_sessions','rate_limits','push_subscriptions','sessions','notification_events','deliveries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end $$;
do $$ declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'dxb_%' loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop;end $$;
