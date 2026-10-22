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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.telegram_deliveries (
  id bigserial primary key,
  chat_id bigint not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  kind text not null default 'scheduled',
  sent_at timestamptz not null default now()
);

create index if not exists telegram_deliveries_recent_idx
  on public.telegram_deliveries (chat_id, sent_at desc);

alter table public.telegram_settings enable row level security;
alter table public.telegram_pending enable row level security;
alter table public.telegram_deliveries enable row level security;

-- Политики не добавляем: доступ только через service_role на сервере.
