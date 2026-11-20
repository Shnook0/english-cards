-- English Cards: пауза между словами «Не знаю» в Telegram-боте.
-- Выполните один раз в Supabase SQL Editor. Миграция добавочная:
-- пока значение не задано (null), бот шлёт «Не знаю» раз в 7 минут, как раньше.

alter table public.telegram_settings
  add column if not exists dont_know_gap_minutes integer
  check (dont_know_gap_minutes is null or dont_know_gap_minutes between 1 and 1440);
