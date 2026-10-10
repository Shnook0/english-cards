import { Card } from '@/types/database'

const PREFIX = 'session:'
// Незаконченную тренировку помним 20 минут
const TTL_MS = 20 * 60 * 1000

export type SavedSession = {
  t: number
  queueIds: string[]
  total: number
  done: number
  wrong: Record<string, number>
  known: string[]
  firstTry?: number
  failed?: number
}

export function loadSession(key: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const saved = JSON.parse(raw) as SavedSession
    if (Date.now() - saved.t > TTL_MS) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    return saved
  } catch {
    return null
  }
}

export function saveSession(key: string, data: Omit<SavedSession, 't'>): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ...data, t: Date.now() }))
  } catch {
    // хранилище недоступно — просто не запоминаем
  }
}

export function clearSession(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // ничего не делаем
  }
}

// Собирает очередь из сохранённых id, берёт свежие данные карточек из базы.
// Если ни одной карточки не нашлось, возвращает null (тренировка начнётся заново).
export function restoreQueue(saved: SavedSession | null, cards: Card[]): Card[] | null {
  if (!saved) return null
  const byId = new Map(cards.map(c => [c.id, c]))
  const queue = saved.queueIds
    .map(id => byId.get(id))
    .filter((c): c is Card => !!c)
  return queue.length > 0 ? queue : null
}

// конец файла