import { dictionary } from 'cmu-pronouncing-dictionary'
import { arpabetToRussian, cleanWord, spellToRussian } from '@/lib/pronounce'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BATCH = 300

function normalizePhrase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = cleanWord(raw).trim().replace(/\s+/g, ' ').toLowerCase()
  if (!value || value.length > 80) return null
  if (!/^[a-z][a-z' .,!?-]*$/.test(value)) return null
  return value
}

// Одно слово: словарь CMU, составное через дефис — по частям, иначе по написанию.
function convertWord(word: string): string {
  const clean = word.replace(/[^a-z'-]/g, '')
  if (!clean) return ''

  const direct = dictionary[clean]
  if (direct) return arpabetToRussian(direct)

  const parts = clean.split('-').filter(Boolean)
  if (parts.length > 1) return parts.map(convertWord).join('')

  return spellToRussian(clean)
}

// Фраза: каждое слово отдельно, так что результат есть всегда.
function pronounce(phrase: string): string {
  return phrase
    .split(' ')
    .map(convertWord)
    .filter(Boolean)
    .join(' ')
}

export async function GET(request: Request): Promise<Response> {
  const phrase = normalizePhrase(new URL(request.url).searchParams.get('word'))
  if (!phrase) return Response.json({ pronunciation: null }, { status: 400 })
  return Response.json({ pronunciation: pronounce(phrase) || null })
}

// Пакетный режим: { words: string[] } → { results: { [слово]: произношение } }
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { words?: unknown } | null
  const list: unknown = body?.words
  const words: unknown[] = Array.isArray(list) ? list.slice(0, MAX_BATCH) : []

  const results: Record<string, string> = {}
  for (const raw of words) {
    if (typeof raw !== 'string') continue
    const phrase = normalizePhrase(raw)
    if (!phrase) continue
    const value = pronounce(phrase)
    if (value) results[raw] = value
  }

  return Response.json({ results })
}
