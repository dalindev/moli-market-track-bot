-- AFK tracker cloud sync (StarCG fork page StarCG_AfkTracker.html).
--
-- One opaque JSON document per secret sync code. The table has RLS enabled and NO policies and all
-- table privileges revoked from the API roles, so it cannot be read or written through PostgREST at
-- all. The only way in is the three SECURITY DEFINER functions below, and every one of them needs the
-- caller to know the sync code (generated in the browser, 26 random base32 chars = 130 bits). Only a
-- SHA-256 of the code is stored, so a database reader cannot recover it either.
--
-- Writes use optimistic concurrency (base revision) so two devices never silently overwrite each other.

create table if not exists public.afk_tracker_state (
  code_hash   text primary key,
  state       jsonb not null,
  revision    bigint not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint afk_tracker_state_hash_len check (char_length(code_hash) = 64),
  constraint afk_tracker_state_is_object check (jsonb_typeof(state) = 'object'),
  constraint afk_tracker_state_size check (octet_length(state::text) <= 2000000)
);

alter table public.afk_tracker_state enable row level security;
revoke all on table public.afk_tracker_state from anon, authenticated;

-- returns {"found": false} or {"found": true, "state": {...}, "revision": n, "updatedAt": "..."}
create or replace function public.afk_state_get(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.afk_tracker_state;
begin
  if p_code is null or char_length(p_code) < 20 or char_length(p_code) > 128 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  select * into v_row
    from public.afk_tracker_state
   where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'state', v_row.state, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
end;
$$;

-- p_base_revision is the revision the caller last saw (0 for a code that has never been written).
-- returns {"ok": true, "revision": n, "updatedAt": "..."} on success, or
--         {"ok": false, "conflict": true, "state": {...}, "revision": n, "updatedAt": "..."} when the
--         stored revision moved on; the caller must decide what to do with the newer cloud copy.
create or replace function public.afk_state_put(p_code text, p_state jsonb, p_base_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row  public.afk_tracker_state;
begin
  if p_code is null or char_length(p_code) < 20 or char_length(p_code) > 128 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if octet_length(p_state::text) > 2000000 then
    raise exception 'state_too_large' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(p_code, 'UTF8')), 'hex');

  select * into v_row from public.afk_tracker_state where code_hash = v_hash for update;

  if not found then
    -- cheap guard against someone filling the free-tier database with throwaway codes
    if (select count(*) from public.afk_tracker_state) >= 5000 then
      raise exception 'capacity_reached' using errcode = '53400';
    end if;
    insert into public.afk_tracker_state (code_hash, state) values (v_hash, p_state)
    on conflict (code_hash) do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('ok', true, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
    end if;
    -- lost a race with a concurrent first write: report it as a conflict
    select * into v_row from public.afk_tracker_state where code_hash = v_hash;
    return jsonb_build_object('ok', false, 'conflict', true, 'state', v_row.state, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
  end if;

  if coalesce(p_base_revision, 0) <> v_row.revision then
    return jsonb_build_object('ok', false, 'conflict', true, 'state', v_row.state, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
  end if;

  update public.afk_tracker_state
     set state = p_state, revision = revision + 1, updated_at = now()
   where code_hash = v_hash
   returning * into v_row;
  return jsonb_build_object('ok', true, 'revision', v_row.revision, 'updatedAt', v_row.updated_at);
end;
$$;

-- lets the user switch sync off and take their data out of the cloud
create or replace function public.afk_state_delete(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  if p_code is null or char_length(p_code) < 20 or char_length(p_code) > 128 then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  delete from public.afk_tracker_state where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted > 0);
end;
$$;

revoke all on function public.afk_state_get(text) from public;
revoke all on function public.afk_state_put(text, jsonb, bigint) from public;
revoke all on function public.afk_state_delete(text) from public;
grant execute on function public.afk_state_get(text) to anon, authenticated;
grant execute on function public.afk_state_put(text, jsonb, bigint) to anon, authenticated;
grant execute on function public.afk_state_delete(text) to anon, authenticated;
