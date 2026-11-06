-- English Cards: произношение русскими буквами («sightseeing (сайтсиинг)»).
-- Выполните один раз в Supabase SQL Editor ДО выкладки новой версии приложения.
-- Миграция добавочная: существующие карточки не меняются.

alter table public.cards add column if not exists pronunciation_ru text;
