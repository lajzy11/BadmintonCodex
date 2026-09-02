-- Badminton Match Master V2.4
-- Cross-table integrity guards and derived values.

-- "Activity date cannot be in the past" is a creation rule. Keeping it in a
-- trigger avoids a CHECK constraint whose meaning changes as time passes.
alter table public.activities
  drop constraint activities_date_not_before_creation_day;

create or replace function public.validate_activity_date_on_create()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.activity_date < (now() at time zone 'Asia/Taipei')::date then
    raise exception using
      errcode = '23514',
      message = 'ACTIVITY_DATE_IS_IN_THE_PAST';
  end if;
  return new;
end;
$$;

create trigger activities_validate_date_on_create
before insert on public.activities
for each row execute function public.validate_activity_date_on_create();

-- A member's selected plan must belong to the same activity.
create or replace function public.validate_activity_member_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.plans p
    where p.id = new.plan_id and p.activity_id = new.activity_id
  ) then
    raise exception using errcode = '23514', message = 'PLAN_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger activity_members_validate_plan
before insert or update of activity_id, plan_id on public.activity_members
for each row execute function public.validate_activity_member_plan();

-- Both sides of a relationship must belong to its activity.
create or replace function public.validate_member_relationship_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.activity_members a, public.activity_members b
    where a.id = new.member_low_id
      and b.id = new.member_high_id
      and a.activity_id = new.activity_id
      and b.activity_id = new.activity_id
  ) then
    raise exception using errcode = '23514', message = 'RELATIONSHIP_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger member_relationships_validate_activity
before insert or update of activity_id, member_low_id, member_high_id
on public.member_relationships
for each row execute function public.validate_member_relationship_activity();

-- Queue members and matches may only reference records in the same activity.
create or replace function public.validate_preview_queue_member_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.preview_queues q
    join public.activity_members am on am.id = new.activity_member_id
    where q.id = new.preview_queue_id and q.activity_id = am.activity_id
  ) then
    raise exception using errcode = '23514', message = 'QUEUE_MEMBER_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger preview_queue_members_validate_activity
before insert or update of preview_queue_id, activity_member_id
on public.preview_queue_members
for each row execute function public.validate_preview_queue_member_activity();

create or replace function public.validate_match_parent_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.courts c
    where c.id = new.court_id and c.activity_id = new.activity_id
  ) then
    raise exception using errcode = '23514', message = 'MATCH_COURT_ACTIVITY_MISMATCH';
  end if;

  if new.source_preview_id is not null and not exists (
    select 1 from public.preview_queues q
    where q.id = new.source_preview_id and q.activity_id = new.activity_id
  ) then
    raise exception using errcode = '23514', message = 'MATCH_PREVIEW_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger matches_validate_parent_activity
before insert or update of activity_id, court_id, source_preview_id on public.matches
for each row execute function public.validate_match_parent_activity();

create or replace function public.validate_match_player_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.matches m
    join public.activity_members am on am.id = new.activity_member_id
    where m.id = new.match_id and m.activity_id = am.activity_id
  ) then
    raise exception using errcode = '23514', message = 'MATCH_PLAYER_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger match_players_validate_activity
before insert or update of match_id, activity_member_id on public.match_players
for each row execute function public.validate_match_player_activity();

create or replace function public.validate_payment_activity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.activity_members am
    where am.id = new.activity_member_id and am.activity_id = new.activity_id
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_MEMBER_ACTIVITY_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger payments_validate_activity
before insert or update of activity_id, activity_member_id on public.payments
for each row execute function public.validate_payment_activity();

-- A claimed or checked-in member must retain the corresponding audit time.
alter table public.activity_members
  drop constraint activity_members_claim_consistency,
  drop constraint activity_members_checkin_consistency;

alter table public.activity_members
  add constraint activity_members_claim_consistency check (
    (claim_status = 'unclaimed' and claimed_at is null and claimed_session_id is null)
    or (claim_status = 'claimed' and claimed_at is not null and claimed_session_id is not null)
  ),
  add constraint activity_members_checkin_consistency check (
    (checkin_status = 'not_arrived' and checked_in_at is null)
    or (checkin_status = 'checked_in' and checked_in_at is not null)
  );

-- Scores derive the first-version result. Equal scores mean "未分勝負";
-- no official 21-point or win-by-two validation is imposed.
alter table public.matches
  drop constraint matches_result_score_consistency;

create or replace function public.derive_match_result()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- With no score, the organizer may still explicitly record A win, B win,
  -- no result, or leave it unrecorded.
  if new.score_a is null then
    return new;
  elsif new.score_a > new.score_b then
    new.result := 'team_a_win';
  elsif new.score_b > new.score_a then
    new.result := 'team_b_win';
  else
    new.result := 'no_result';
  end if;
  return new;
end;
$$;

create trigger matches_derive_result
before insert or update of score_a, score_b on public.matches
for each row execute function public.derive_match_result();

-- Lock down helpers: table access remains governed by RLS, while only the
-- intended authenticated role may invoke authorization helpers.
revoke all on function public.is_organization_owner(uuid) from public;
revoke all on function public.owns_activity(uuid) from public;
revoke all on function public.activity_for_plan(uuid) from public;
revoke all on function public.activity_for_member(uuid) from public;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant execute on function public.owns_activity(uuid) to authenticated;
grant execute on function public.activity_for_plan(uuid) to authenticated;
grant execute on function public.activity_for_member(uuid) to authenticated;
