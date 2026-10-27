import { Card } from '@/types/database'
import { GeneralProgress } from '@/types/general'

// Интервалы повторения (дни)
export const INTERVALS_DAYS = [1, 2, 3, 5, 7, 12, 15, 20, 25, 27, 30]
// Через сколько карточек слово вернётся в этой же сессии после «Не знаю» (1-й, 2-й, 3-й раз)
export const REINSERT_OFFSETS = [2, 10, 15]
// Сколько новых слов за одну сессию
export const NEW_PER_SESSION = 15
// Максимум слов «по расписанию» за одну сессию
export const MAX_REVIEW_PER_SESSION = 40
// Сколько дней слово сидит в «Общих ошибках»
export const MISTAKE_DAYS = 2
// Сколько «Знаю» подряд нужно, чтобы слово вышло из ошибок раньше
export const MISTAKE_STREAK_TO_CLEAR = 2

// Копии слова в разных папках (одинаковый sync_group_id) считаем одним словом
export function wordKey(card: Card): string {
  return card.sync_group_id ?? card.id
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function isMistakeActive(p: GeneralProgress | undefined, now: number = Date.now()): boolean {
  return !!p && !!p.mistake_until && new Date(p.mistake_until).getTime() > now
}

// Очередь сессии: 1) ошибки, 2) слова по расписанию, 3) новые
export function buildQueue(
  cards: Card[],
  progress: Record<string, GeneralProgress>,
  onlyMistakes: boolean
): Card[] {
  const now = Date.now()
  const mistakes: Card[] = []
  const due: { card: Card; t: number }[] = []
  const fresh: Card[] = []

  for (const c of cards) {
    const p = progress[wordKey(c)]
    if (!p) {
      fresh.push(c)
    } else if (isMistakeActive(p, now)) {
      mistakes.push(c)
    } else {
      const t = new Date(p.next_review_at).getTime()
      if (t <= now) due.push({ card: c, t })
    }
  }

  if (onlyMistakes) return shuffle(mistakes)

  due.sort((a, b) => a.t - b.t)

  return [
    ...shuffle(mistakes),
    ...due.slice(0, MAX_REVIEW_PER_SESSION).map(d => d.card),
    ...shuffle(fresh).slice(0, NEW_PER_SESSION),
  ]
}

export function getStats(cards: Card[], progress: Record<string, GeneralProgress>) {
  const now = Date.now()
  let fresh = 0
  let due = 0
  let mistakes = 0
  for (const c of cards) {
    const p = progress[wordKey(c)]
    if (!p) fresh++
    else if (isMistakeActive(p, now)) mistakes++
    else if (new Date(p.next_review_at).getTime() <= now) due++
  }
  const session = mistakes + Math.min(due, MAX_REVIEW_PER_SESSION) + Math.min(fresh, NEW_PER_SESSION)
  return { total: cards.length, fresh, due, mistakes, session }
}