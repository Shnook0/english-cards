import { supabase } from '@/lib/supabase'
import { Card } from '@/types/database'

// Интервалы повторения для карточек в папках (дни), как в обычной тренировке
export const SRS_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 120, 240]
// Сколько правильных ответов подряд делают слово выученным
export const LEARNED_STREAK = 3
// Сколько слов берём за одну сессию в «Подборе» и «Диктанте»
export const SESSION_LIMIT = 20
// Через сколько карточек слово вернётся после ошибки (1-й, 2-й, 3-й раз)
export const STUDY_REINSERT_OFFSETS = [2, 10, 15]

const DAY_MS = 24 * 60 * 60 * 1000

export type RecordResult = (card: Card, correct: boolean) => Promise<boolean>

export type StudyGameProps = {
  cards: Card[]
  recordResult: RecordResult
  onNextRound: () => void
  onExit: () => void
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Очередь слов для любого режима:
// 1) слова с ошибками (больше ошибок = раньше), 2) слова, у которых наступил срок повтора,
// 3) новые слова, 4) выученные слова, у которых наступил срок повтора
export function buildStudyQueue(cards: Card[], limit?: number): Card[] {
  const now = Date.now()
  const errors: Card[] = []
  const due: Card[] = []
  const fresh: Card[] = []
  const learnedDue: Card[] = []

  for (const c of cards) {
    const wrong = c.wrong_count || 0
    const isDue = new Date(c.next_review_at).getTime() <= now
    if (wrong > 0) {
      errors.push(c)
    } else if (c.learned_at) {
      if (isDue) learnedDue.push(c)
    } else if ((c.srs_level || 0) === 0 && (c.known_streak || 0) === 0) {
      fresh.push(c)
    } else if (isDue) {
      due.push(c)
    }
  }

  const sortedErrors = shuffle(errors).sort((a, b) => (b.wrong_count || 0) - (a.wrong_count || 0))
  const queue = [...sortedErrors, ...shuffle(due), ...shuffle(fresh), ...shuffle(learnedDue)]
  return limit ? queue.slice(0, limit) : queue
}

// Что записать в карточку после правильного ответа (логика как в обычной «Учить»)
export function patchCorrect(card: Card, isLevel: boolean): Partial<Card> {
  const oldSrs = card.srs_level || 0
  const days = SRS_INTERVALS_DAYS[oldSrs] ?? 240
  const newStreak = (card.known_streak || 0) + 1

  const patch: Record<string, unknown> = {
    srs_level: Math.min(oldSrs + 1, 7),
    known_streak: newStreak,
    wrong_count: Math.max((card.wrong_count || 0) - 1, 0),
    next_review_at: new Date(Date.now() + days * DAY_MS).toISOString(),
  }

  if (!card.learned_at && (isLevel || newStreak >= LEARNED_STREAK)) {
    patch.learned_at = new Date().toISOString()
  }

  return patch as Partial<Card>
}

// Что записать в карточку после ошибки (логика как в обычной «Учить»)
export function patchWrong(card: Card, isLevel: boolean): Partial<Card> {
  const wasLearned = !!card.learned_at
  const wrong = card.wrong_count || 0

  let wrongCount: number
  if (isLevel) wrongCount = Math.max(wrong + 1, 5)
  else if (wasLearned) wrongCount = Math.max(wrong + 1, 2)
  else wrongCount = wrong + 1

  const patch: Partial<Card> = {
    srs_level: 0,
    known_streak: 0,
    wrong_count: wrongCount,
    next_review_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }
  if (wasLearned) patch.learned_at = null
  return patch
}

export async function saveCardPatch(cardId: string, patch: Partial<Card>): Promise<boolean> {
  const { error } = await supabase.from('cards').update(patch).eq('id', cardId)
  return !error
}

// ---------- Проверка ответов ----------

export function normalizeEnglish(s: string): string {
  return s.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

// Диктант: регистр и лишние пробелы не важны, опечатки не прощаются
export function isSpellingCorrect(input: string, word: string): boolean {
  return normalizeEnglish(input) === normalizeEnglish(word)
}

export function normalizeRu(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zа-я0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[n]
}

// Перевод: подходит любой из вариантов через запятую, опечатка в 1–2 буквы прощается
export function isTranslationCorrect(input: string, translation: string): boolean {
  const answer = normalizeRu(input)
  if (!answer) return false

  const variants = new Set<string>()
  const full = normalizeRu(translation)
  if (full) variants.add(full)
  for (const part of translation.split(/[,;/]/)) {
    const v = normalizeRu(part)
    if (v) variants.add(v)
  }

  for (const v of variants) {
    const maxDist = v.length <= 3 ? 0 : v.length <= 8 ? 1 : 2
    if (levenshtein(answer, v) <= maxDist) return true
  }
  return false
}

// ---------- Озвучка ----------

export function warmUpVoices() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.getVoices()
  }
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()

  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = 0.9
  u.pitch = 1

  const voices = window.speechSynthesis.getVoices()
  const best =
    voices.find(v => v.name === 'Google US English') ||
    voices.find(v => v.lang === 'en-US' && v.localService === false) ||
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang.startsWith('en'))
  if (best) u.voice = best

  window.speechSynthesis.speak(u)
}