import { dictionary } from 'cmu-pronouncing-dictionary'
import { arpabetToRussian } from '@/lib/pronounce'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizePhrase(raw: string | null): string[] | null {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!value || value.length > 60) return null
  if (!/^[a-zA-Z][a-zA-Z' -]*$/.test(value)) return null
  return value.toLowerCase().split(' ')
}

// Слово из фразы или составное слово через дефис («well-known» → well + known)
function lookup(word: string): string | null {
  const direct = dictionary[word]
  if (direct) return arpabetToRussian(direct)

  const parts = word.split('-').filter(Boolean)
  if (parts.length < 2) return null

  const converted = parts.map(part => (dictionary[part] ? arpabetToRussian(dictionary[part]) : null))
  return converted.every(Boolean) ? converted.join('') : null
}

export async function GET(request: Request): Promise<Response> {
  const words = normalizePhrase(new URL(request.url).searchParams.get('word'))
  if (!words) return Response.json({ pronunciation: null }, { status: 400 })

  const parts: string[] = []
  for (const word of words) {
    const converted = lookup(word)
    // Если для какого-то слова фразы нет записи, лучше ничего, чем мусор.
    if (!converted) return Response.json({ pronunciation: null })
    parts.push(converted)
  }

  return Response.json({ pronunciation: parts.join(' ') })
}
