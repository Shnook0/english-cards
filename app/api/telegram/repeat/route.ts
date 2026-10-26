import { db, queueRegularRepeat } from '@/lib/telegram/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authenticatedUserId(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data, error } = await db().auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function POST(request: Request): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json({ ok: false, error: 'Нужна авторизация' }, { status: 401 })
  }

  let cardId = ''
  try {
    const body = (await request.json()) as { cardId?: unknown }
    cardId = typeof body.cardId === 'string' ? body.cardId : ''
  } catch {
    cardId = ''
  }
  if (!cardId) {
    return Response.json({ ok: false, error: 'Не указано слово' }, { status: 400 })
  }

  try {
    const queued = await queueRegularRepeat(userId, cardId)
    return Response.json({ ok: true, queued })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
