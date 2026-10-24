-- Telegram-бот для flashcards-app.
-- Выполни один раз в Supabase Dashboard -> SQL Editor.

create table if not exists public.telegram_settings (
  chat_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  timezone text not null default 'Europe/Moscow',
  window_start time not null default '09:00',
  window_end time not null default '21:00',
  interval_minutes integer not null default 60 check (interval_minutes between 5 and 1440),
  paused boolean not null default false,
  last_sent_at timestamptz,
  last_activity_at timestamptz,
  awaiting_input text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telegram_settings
  add column if not exists last_activity_at timestamptz;

alter table public.telegram_settings
  add column if not exists awaiting_input text;

alter table public.telegram_settings
  add column if not exists linked boolean not null default true;

alter table public.telegram_settings
  add column if not exists reveal_mode text not null default 'open';

create unique index if not exists telegram_settings_active_user_idx
  on public.telegram_settings (user_id)
  where linked;

-- Одноразовые коды для привязки чата к аккаунту на сайте.
create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes (user_id)
  where used_at is null;

create table if not exists public.telegram_pending (
  id bigserial primary key,
  chat_id bigint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists telegram_pending_due_idx
  on public.telegram_pending (chat_id, due_at)
  where sent_at is null;

-- Очередь слов «Не знаю»: 15 минут, 2 и 5 часов, затем 1, 2, 4, 7, 15 и 30 дней.
-- stage: 0 = +15 минут, 1 = +2 часа, 2 = +5 часов, 3 = +1 день,
-- 4 = +2 дня, 5 = +4 дня, 6–7 = +7 дней дважды, 8 = +15 дней, 9 = +30 дней.
alter table public.telegram_pending
  add column if not exists stage integer;

-- Старая очередь повторов. Оставлена для уже запланированных слов;
-- новые повторы «Не знаю» пишутся в telegram_pending.
create table if not exists public.telegram_reviews (
  id bigserial primary key,
  chat_id bigint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  stage integer not null,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists telegram_reviews_due_idx
  on public.telegram_reviews (chat_id, due_at)
  where sent_at is null;

create table if not exists public.telegram_deliveries (
  id bigserial primary key,
  chat_id bigint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  kind text not null default 'scheduled',
  sent_at timestamptz not null default now()
);

create index if not exists telegram_deliveries_recent_idx
  on public.telegram_deliveries (chat_id, sent_at desc);

-- Слова, которые больше не должны приходить в Telegram.
-- В папке на сайте они остаются без изменений.
create table if not exists public.telegram_muted_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

alter table public.telegram_settings enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_pending enable row level security;
alter table public.telegram_reviews enable row level security;
alter table public.telegram_deliveries enable row level security;
alter table public.telegram_muted_cards enable row level security;

-- Политики не добавляем: доступ только через service_role на сервере.
