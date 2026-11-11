'use client'

// Произношение для карточек, у которых оно не сохранено: спрашиваем сервер
// (словарь CMU) пачкой, кэшируем на устройстве, без сети — по написанию.

import { useEffect, useSyncExternalStore } from 'react'
import { cleanWord, knownPronunciation, spellToRussian } from '@/lib/pronounce'

const CACHE_KEY = 'english-cards:pron-cache:v1'
const MAX_CACHE = 5000

let cache: Record<string, string> | null = null
const pending = new Set<string>()
const failed = new Set<string>()
const listeners = new Set<() => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let version = 0

function key(word: string): string {
  return cleanWord(word).trim().toLowerCase()
}

function loadCache(): Record<string, string> {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    cache = raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    cache = {}
  }
  return cache
}

function saveCache(): void {
  if (!cache) return
  try {
    const entries = Object.entries(cache)
    if (entries.length > MAX_CACHE) cache = Object.fromEntries(entries.slice(-MAX_CACHE))
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // нет места или нет localStorage: просто не запомним
  }
}

function notify(): void {
  version += 1
  listeners.forEach(listener => listener())
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

// Пакетный запрос к /api/pronounce. Для слов без ответа — запись по написанию.
export async function fetchPronunciations(words: string[]): Promise<Record<string, string>> {
  const store = loadCache()
  const result: Record<string, string> = {}
  const missing: string[] = []

  for (const word of words) {
    const k = key(word)
    if (!k) continue
    if (store[k]) result[k] = store[k]
    else if (!missing.includes(k)) missing.push(k)
  }

  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200)
    const { signal, done } = withTimeout(8000)
    try {
      const res = await fetch('/api/pronounce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: chunk }),
        cache: 'no-store',
        signal,
      })
      const data = (await res.json().catch(() => null)) as { results?: Record<string, unknown> } | null
      for (const k of chunk) {
        const value = data?.results?.[k]
        if (typeof value === 'string' && value.trim()) {
          store[k] = value.trim()
          result[k] = store[k]
        }
      }
    } catch {
      // без сети — ниже подставим по написанию
    } finally {
      done()
    }
  }

  saveCache()
  for (const k of missing) {
    if (!result[k]) result[k] = spellToRussian(k)
  }
  return result
}

// Одно слово (форма добавления): словарь, а если не вышло — по написанию.
export async function fetchPronunciation(word: string): Promise<string> {
  const k = key(word)
  if (!k) return ''
  const result = await fetchPronunciations([k])
  return result[k] ?? spellToRussian(k)
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(async () => {
    flushTimer = null
    const words = Array.from(pending)
    if (words.length === 0) return
    await fetchPronunciations(words)
    const store = loadCache()
    for (const word of words) {
      pending.delete(word)
      if (!store[word]) failed.add(word)
    }
    notify()
  }, 60)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

type PronSource = {
  word: string
  transcription?: string | null
  pronunciation_ru?: string | null
}

// Произношение карточки для показа. Пустая строка — пока ещё загружается.
export function useCardPronunciation(card: PronSource | null | undefined): string {
  // перерисовываемся, когда приходят ответы сервера
  // (на сервере и при гидратации — -1: кэш устройства ещё не читаем)
  const snapshot = useSyncExternalStore(subscribe, () => version, () => -1)

  const known = card ? knownPronunciation(card) : null
  const k = card && !known ? key(card.word) : ''

  useEffect(() => {
    if (!k) return
    const store = loadCache()
    if (store[k] || failed.has(k) || pending.has(k)) return
    pending.add(k)
    scheduleFlush()
  }, [k])

  if (!card) return ''
  if (known) return known
  if (!k) return ''
  if (snapshot === -1) return ''
  const cached = loadCache()[k]
  if (cached) return cached
  if (failed.has(k)) return spellToRussian(k)
  return ''
}
