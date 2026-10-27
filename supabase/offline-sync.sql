-- English Cards: offline sync schema
-- Apply this migration once in Supabase SQL Editor.
-- It is additive: existing rows and Telegram bot behaviour are preserved.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- cards: content version + last answer time
-- ---------------------------------------------------------------------------

alter table public.cards
  add column if not exists content_updated_at timestamptz not null default now();

alter table public.cards
  add column if not exists last_answer_at timestamptz;

create or replace function public.cards_touch_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.word is distinct from old.word
     or new.transcription is distinct from old.transcription
     or new.translation is distinct from old.translation
     or new.sentences is distinct from old.sentences
     or new.folder_id is distinct from old.folder_id then
    new.content_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists cards_touch_content_updated_at on public.cards;

create trigger cards_touch_content_updated_at
before update on public.cards
for each row execute function public.cards_touch_content_updated_at();

-- ---------------------------------------------------------------------------
-- Answer events (idempotency keys for offline retries)
-- ---------------------------------------------------------------------------

create table if not exists public.card_answer_events (
  id uuid primary key,
  user_id uuid not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  correct boolean not null,
  is_level boolean not null default false,
  answered_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists card_answer_events_user_idx
  on public.card_answer_events(user_id, answered_at desc);

create table if not exists public.general_answer_events (
  id uuid primary key,
  user_id uuid not null,
  training_id uuid not null references public.general_trainings(id) on delete cascade,
  word_key text not null,
  correct boolean not null,
  answered_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists general_answer_events_user_idx
  on public.general_answer_events(user_id, answered_at desc);

alter table public.card_answer_events enable row level security;
alter table public.general_answer_events enable row level security;

drop policy if exists "card_answer_events_select_own" on public.card_answer_events;
create policy "card_answer_events_select_own"
  on public.card_answer_events for select
  using (auth.uid() = user_id);

drop policy if exists "card_answer_events_insert_own" on public.card_answer_events;
create policy "card_answer_events_insert_own"
  on public.card_answer_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "general_answer_events_select_own" on public.general_answer_events;
create policy "general_answer_events_select_own"
  on public.general_answer_events for select
  using (auth.uid() = user_id);

drop policy if exists "general_answer_events_insert_own" on public.general_answer_events;
create policy "general_answer_events_insert_own"
  on public.general_answer_events for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- apply_card_answer: same rules as lib/study.ts patchCorrect/patchWrong
-- ---------------------------------------------------------------------------

create or replace function public.apply_card_answer(
  p_event_id uuid,
  p_card_id uuid,
  p_correct boolean,
  p_is_level boolean,
  p_answered_at timestamptz
)
returns setof public.cards
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_card public.cards%rowtype;
  v_inserted integer := 0;
  v_old_srs integer;
  v_days integer;
  v_streak integer;
  v_wrong integer;
  v_was_learned boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_card
  from public.cards
  where id = p_card_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'card not found';
  end if;

  insert into public.card_answer_events (
    id, user_id, card_id, correct, is_level, answered_at
  ) values (
    p_event_id, v_uid, p_card_id, p_correct, p_is_level, p_answered_at
  )
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select c.* from public.cards c where c.id = p_card_id and c.user_id = v_uid;
    return;
  end if;

  if p_correct then
    v_old_srs := least(greatest(coalesce(v_card.srs_level, 0), 0), 7);
    v_days := case v_old_srs
      when 0 then 1
      when 1 then 3
      when 2 then 7
      when 3 then 14
      when 4 then 30
      when 5 then 60
      when 6 then 120
      else 240
    end;
    v_streak := coalesce(v_card.known_streak, 0) + 1;
    v_wrong := greatest(coalesce(v_card.wrong_count, 0) - 1, 0);

    update public.cards set
      srs_level = least(v_old_srs + 1, 7),
      known_streak = v_streak,
      wrong_count = v_wrong,
      next_review_at = p_answered_at + (v_days || ' days')::interval,
      learned_at = coalesce(
        v_card.learned_at,
        case when p_is_level or v_streak >= 3 then p_answered_at else null end
      ),
      last_answer_at = p_answered_at
    where id = p_card_id and user_id = v_uid
    returning * into v_card;
  else
    v_was_learned := v_card.learned_at is not null;
    v_wrong := case
      when p_is_level then greatest(coalesce(v_card.wrong_count, 0) + 1, 5)
      when v_was_learned then greatest(coalesce(v_card.wrong_count, 0) + 1, 2)
      else coalesce(v_card.wrong_count, 0) + 1
    end;

    update public.cards set
      srs_level = 0,
      known_streak = 0,
      wrong_count = v_wrong,
      next_review_at = p_answered_at + interval '10 minutes',
      learned_at = case when v_was_learned then null else v_card.learned_at end,
      last_answer_at = p_answered_at
    where id = p_card_id and user_id = v_uid
    returning * into v_card;
  end if;

  return next v_card;
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_general_answer: same rules as components/GeneralTrainSession.tsx
-- ---------------------------------------------------------------------------

create or replace function public.apply_general_answer(
  p_event_id uuid,
  p_training_id uuid,
  p_word_key text,
  p_correct boolean,
  p_answered_at timestamptz
)
returns public.general_progress
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_progress public.general_progress%rowtype;
  v_inserted integer := 0;
  v_days integer;
  v_level integer;
  v_streak integer;
  v_mistake_until timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.general_trainings
    where id = p_training_id and user_id = v_uid
  ) then
    raise exception 'training not found';
  end if;

  insert into public.general_progress (
    training_id, word_key, user_id, level, next_review_at,
    mistake_until, mistake_streak, wrong_total, updated_at
  ) values (
    p_training_id, p_word_key, v_uid, 0, p_answered_at,
    null, 0, 0, p_answered_at
  )
  on conflict (training_id, word_key) do nothing;

  select * into v_progress
  from public.general_progress
  where training_id = p_training_id and word_key = p_word_key
  for update;

  insert into public.general_answer_events (
    id, user_id, training_id, word_key, correct, answered_at
  ) values (
    p_event_id, v_uid, p_training_id, p_word_key, p_correct, p_answered_at
  )
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return v_progress;
  end if;

  if p_correct then
    v_level := greatest(coalesce(v_progress.level, 0), 0);
    v_days := case least(v_level, 10)
      when 0 then 1
      when 1 then 2
      when 2 then 3
      when 3 then 5
      when 4 then 7
      when 5 then 12
      when 6 then 15
      when 7 then 20
      when 8 then 25
      when 9 then 27
      else 30
    end;

    v_streak := coalesce(v_progress.mistake_streak, 0);
    v_mistake_until := v_progress.mistake_until;

    if v_mistake_until is not null and v_mistake_until > p_answered_at then
      v_streak := v_streak + 1;
      if v_streak >= 2 then
        v_mistake_until := null;
        v_streak := 0;
      end if;
    else
      v_mistake_until := null;
      v_streak := 0;
    end if;

    update public.general_progress set
      level = least(v_level + 1, 10),
      next_review_at = p_answered_at + (v_days || ' days')::interval,
      mistake_until = v_mistake_until,
      mistake_streak = v_streak,
      updated_at = p_answered_at
    where training_id = p_training_id and word_key = p_word_key
    returning * into v_progress;
  else
    update public.general_progress set
      level = greatest(coalesce(level, 0) - 2, 0),
      next_review_at = p_answered_at + interval '1 day',
      mistake_until = p_answered_at + interval '2 days',
      mistake_streak = 0,
      wrong_total = coalesce(wrong_total, 0) + 1,
      updated_at = p_answered_at
    where training_id = p_training_id and word_key = p_word_key
    returning * into v_progress;
  end if;

  return v_progress;
end;
$$;

-- ---------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------

create or replace function public.save_match_record(p_scope text, p_time numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.match_records (user_id, scope, best_time, updated_at)
  values (v_uid, p_scope, p_time, now())
  on conflict (user_id, scope) do update
    set best_time = excluded.best_time,
        updated_at = now()
    where excluded.best_time < public.match_records.best_time;
end;
$$;

create or replace function public.save_blocks_record(p_scope text, p_score integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.blocks_records (user_id, scope, best_score, updated_at)
  values (v_uid, p_scope, p_score, now())
  on conflict (user_id, scope) do update
    set best_score = excluded.best_score,
        updated_at = now()
    where excluded.best_score > public.blocks_records.best_score;
end;
$$;

revoke all on function public.apply_card_answer(uuid, uuid, boolean, boolean, timestamptz) from public;
revoke all on function public.apply_general_answer(uuid, uuid, text, boolean, timestamptz) from public;
revoke all on function public.save_match_record(text, numeric) from public;
revoke all on function public.save_blocks_record(text, integer) from public;

grant execute on function public.apply_card_answer(uuid, uuid, boolean, boolean, timestamptz) to authenticated;
grant execute on function public.apply_general_answer(uuid, uuid, text, boolean, timestamptz) to authenticated;
grant execute on function public.save_match_record(text, numeric) to authenticated;
grant execute on function public.save_blocks_record(text, integer) to authenticated;
