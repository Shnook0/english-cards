-- Telegram-бот: оставить в очереди только последние 20 слов с «Не знаю».
-- Запустите один раз в Supabase Dashboard -> SQL Editor.
--
-- «Последние» считаются по времени, когда вы нажали «Не знаю» (по созданию записей очереди).
-- Остальные записи «Не знаю» помечаются отправленными, как это делает сам бот при сбросе очереди,
-- поэтому ничего не удаляется. Плановые повторы из папок (этапы 100 и выше) не затрагиваются.

-- 1) Предпросмотр: сколько слов останется и сколько будет сброшено.
with q as (
  select chat_id, card_id, created_at
  from public.telegram_pending
  where sent_at is null and stage < 100
  union all
  select chat_id, card_id, created_at
  from public.telegram_reviews
  where sent_at is null and stage < 100
), ranked as (
  select
    chat_id,
    card_id,
    row_number() over (partition by chat_id order by max(created_at) desc) as rn
  from q
  group by chat_id, card_id
)
select
  count(*) filter (where rn <= 20) as keep_words,
  count(*) filter (where rn > 20) as reset_words
from ranked;

-- 2) Сама очистка.
begin;

create temp table dont_know_keep on commit drop as
with q as (
  select chat_id, card_id, created_at
  from public.telegram_pending
  where sent_at is null and stage < 100
  union all
  select chat_id, card_id, created_at
  from public.telegram_reviews
  where sent_at is null and stage < 100
)
select chat_id, card_id
from (
  select
    chat_id,
    card_id,
    row_number() over (partition by chat_id order by max(created_at) desc) as rn
  from q
  group by chat_id, card_id
) ranked
where rn <= 20;

update public.telegram_pending p
set sent_at = now()
where p.sent_at is null
  and p.stage < 100
  and not exists (
    select 1 from dont_know_keep k
    where k.chat_id = p.chat_id and k.card_id = p.card_id
  );

update public.telegram_reviews r
set sent_at = now()
where r.sent_at is null
  and r.stage < 100
  and not exists (
    select 1 from dont_know_keep k
    where k.chat_id = r.chat_id and k.card_id = r.card_id
  );

commit;

-- 3) Проверка: в очереди должно остаться не больше 20 слов с «Не знаю» на чат.
select chat_id, count(distinct card_id) as dont_know_words
from (
  select chat_id, card_id from public.telegram_pending where sent_at is null and stage < 100
  union all
  select chat_id, card_id from public.telegram_reviews where sent_at is null and stage < 100
) q
group by chat_id;
