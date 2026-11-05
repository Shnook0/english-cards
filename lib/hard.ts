import type { Card } from '@/types/database'

// «Сложные слова» папки.
//
// Вход: слово попадает в список после 2 ошибок («Не знаю»). Каждое «Знаю» снимает
// одну накопленную ошибку, поэтому случайный промах список не засоряет.
//
// Выход: слово уходит, только если его «Знаю» подтвердилось в другой день.
//  1. Два «Знаю» подряд — первая серия. Это ещё кратковременная память, слово остаётся.
//  2. Не раньше чем через HARD_CONFIRM_GAP_MS нужна вторая серия из двух «Знаю» подряд.
//     Одно «Знаю» после паузы слово не отпускает.
//  3. Любое «Не знаю» сбрасывает прогресс выхода.
// Тот же алгоритм продублирован в supabase/hard-words.sql (apply_card_answer).

export const HARD_ENTER_MISSES = 2
export const HARD_RUN_LENGTH = 2
export const HARD_CONFIRM_GAP_MS = 12 * 60 * 60 * 1000

type HardFields = Pick<Card, 'hard_since' | 'hard_misses' | 'hard_run' | 'hard_confirmed_at'>

export function isHard(card: Pick<Card, 'hard_since'>): boolean {
  return Boolean(card.hard_since)
}

export const HARD_CLEARED: HardFields = {
  hard_since: null,
  hard_misses: 0,
  hard_run: 0,
  hard_confirmed_at: null,
}

export function hardAfterWrong(card: Card, at: number): Partial<Card> {
  const misses = (card.hard_misses ?? 0) + 1
  const alreadyHard = isHard(card)

  return {
    hard_misses: misses,
    hard_since: alreadyHard
      ? card.hard_since
      : misses >= HARD_ENTER_MISSES
      ? new Date(at).toISOString()
      : null,
    hard_run: 0,
    hard_confirmed_at: null,
  }
}

export function hardAfterCorrect(card: Card, at: number): Partial<Card> {
  if (!isHard(card)) {
    return { hard_misses: Math.max((card.hard_misses ?? 0) - 1, 0) }
  }

  const run = (card.hard_run ?? 0) + 1
  if (run < HARD_RUN_LENGTH) return { hard_run: run }

  // Серия из двух «Знаю» подряд завершена.
  const confirmedAt = card.hard_confirmed_at ? Date.parse(card.hard_confirmed_at) : null
  if (confirmedAt === null) {
    return { hard_run: 0, hard_confirmed_at: new Date(at).toISOString() }
  }
  if (at - confirmedAt >= HARD_CONFIRM_GAP_MS) return { ...HARD_CLEARED }

  // Вторая серия в тот же день — ещё не подтверждение.
  return { hard_run: 0 }
}
