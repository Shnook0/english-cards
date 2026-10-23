export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; translations: string[] }>()

function normalizeWord(raw: string | null): string | null {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!value || value.length > 60) return null
  if (!/^[a-zA-Z][a-zA-Z' -]*$/.test(value)) return null
  return value
}

function pushUnique(target: string[], value: unknown): void {
  if (typeof value !== 'string') return

  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return

  const key = clean.toLowerCase()
  if (target.some(item => item.toLowerCase() === key)) return

  target.push(clean)
}

async function translateWithGoogle(word: string): Promise<string[]> {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    '?client=gtx&sl=en&tl=ru&dt=t&dt=bd&q=' +
    encodeURIComponent(word)

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Google Translate: HTTP ${response.status}`)
  }

  const data = (await response.json()) as unknown
  const translations: string[] = []

  if (Array.isArray(data)) {
    const segments = data[0]
    if (Array.isArray(segments)) {
      for (const segment of segments) {
        if (Array.isArray(segment)) pushUnique(translations, segment[0])
      }
    }

    const dictionary = data[1]
    if (Array.isArray(dictionary)) {
      for (const group of dictionary) {
        if (!Array.isArray(group)) continue

        const meanings = group[1]
        if (!Array.isArray(meanings)) continue

        for (const meaning of meanings) pushUnique(translations, meaning)
      }
    }
  }

  return translations
}

async function translateWithMyMemory(word: string): Promise<string[]> {
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(word) +
    '&langpair=en%7Cru'

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`MyMemory: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    responseData?: { translatedText?: unknown }
  }

  const translations: string[] = []
  pushUnique(translations, data.responseData?.translatedText)
  return translations
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const word = normalizeWord(url.searchParams.get('word'))

  if (!word) {
    return Response.json({ translations: [] }, { status: 400 })
  }

  const cacheKey = word.toLowerCase()
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Response.json({ translations: cached.translations })
  }

  let translations: string[] = []

  try {
    translations = await translateWithGoogle(word)
  } catch (error) {
    console.error('translate Google:', error)
  }

  if (translations.length === 0) {
    try {
      translations = await translateWithMyMemory(word)
    } catch (error) {
      console.error('translate MyMemory:', error)
    }
  }

  const normalized = translations
    .filter(item => item.toLowerCase() !== word.toLowerCase())
    .slice(0, 8)

  if (normalized.length > 0) {
    cache.set(cacheKey, { at: Date.now(), translations: normalized })
  }

  return Response.json({ translations: normalized })
}
