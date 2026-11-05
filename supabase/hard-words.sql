-- English Cards: «Сложные слова» папки.
-- Выполните один раз в Supabase SQL Editor ДО выкладки новой версии приложения.
-- Миграция добавочная: существующие данные не меняются.
--
-- Логика (дублирует lib/hard.ts):
--  * вход: слово попадает в список после 2 ошибок; каждое «Знаю» снимает одну ошибку;
--  * выход: две серии «Знаю» подряд (по 2 ответа), между которыми прошло >= 12 часов;
--  * любое «Не знаю» сбрасывает прогресс выхода.

alter table public.cards add column if not exists hard_since timestamptz;
alter table public.cards add column if not exists hard_misses integer not null default 0;
alter table public.cards add column if not exists hard_run integer not null default 0;
alter table public.cards add column if not exists hard_confirmed_at timestamptz;

create index if not exists cards_hard_idx
  on public.cards(user_id, folder_id) where hard_since is not null;

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
  v_h_since timestamptz;
  v_h_misses integer;
  v_h_run integer;
  v_h_confirmed timestamptz;
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

  v_h_since := v_card.hard_since;
  v_h_misses := coalesce(v_card.hard_misses, 0);
  v_h_run := coalesce(v_card.hard_run, 0);
  v_h_confirmed := v_card.hard_confirmed_at;

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

    if v_h_since is null then
      v_h_misses := greatest(v_h_misses - 1, 0);
    else
      v_h_run := v_h_run + 1;
      if v_h_run >= 2 then
        if v_h_confirmed is null then
          v_h_run := 0;
          v_h_confirmed := p_answered_at;
        elsif p_answered_at - v_h_confirmed >= interval '12 hours' then
          v_h_since := null;
          v_h_misses := 0;
          v_h_run := 0;
          v_h_confirmed := null;
        else
          v_h_run := 0;
        end if;
      end if;
    end if;

    update public.cards set
      srs_level = least(v_old_srs + 1, 7),
      known_streak = v_streak,
      wrong_count = v_wrong,
      next_review_at = p_answered_at + (v_days || ' days')::interval,
      learned_at = coalesce(
        v_card.learned_at,
        case when p_is_level or v_streak >= 3 then p_answered_at else null end
      ),
      last_answer_at = p_answered_at,
      hard_since = v_h_since,
      hard_misses = v_h_misses,
      hard_run = v_h_run,
      hard_confirmed_at = v_h_confirmed
    where id = p_card_id and user_id = v_uid
    returning * into v_card;
  else
    v_was_learned := v_card.learned_at is not null;
    v_wrong := case
      when p_is_level then greatest(coalesce(v_card.wrong_count, 0) + 1, 5)
      when v_was_learned then greatest(coalesce(v_card.wrong_count, 0) + 1, 2)
      else coalesce(v_card.wrong_count, 0) + 1
    end;

    v_h_misses := v_h_misses + 1;
    if v_h_since is null and v_h_misses >= 2 then
      v_h_since := p_answered_at;
    end if;
    v_h_run := 0;
    v_h_confirmed := null;

    update public.cards set
      srs_level = 0,
      known_streak = 0,
      wrong_count = v_wrong,
      next_review_at = p_answered_at + interval '10 minutes',
      learned_at = case when v_was_learned then null else v_card.learned_at end,
      last_answer_at = p_answered_at,
      hard_since = v_h_since,
      hard_misses = v_h_misses,
      hard_run = v_h_run,
      hard_confirmed_at = v_h_confirmed
    where id = p_card_id and user_id = v_uid
    returning * into v_card;
  end if;

  return next v_card;
  return;
end;
$$;

revoke all on function public.apply_card_answer(uuid, uuid, boolean, boolean, timestamptz) from public;
grant execute on function public.apply_card_answer(uuid, uuid, boolean, boolean, timestamptz) to authenticated;
