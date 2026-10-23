import { getBotUsername, sendMessage } from '@/lib/telegram/api'
import {
  createLinkCode,
  db,
  getSettingsForUser,
  unlinkUser,
} from '@/lib/telegram/store'

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

async function botUrl(code?: string): Promise<string | null> {
  const username = await getBotUsername()
  if (!username) return null
  return code ? `https://t.me/${username}?start=${code}` : `https://t.me/${username}`
}

export async function GET(request: Request): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json({ ok: false, error: 'Нужна авторизация' }, { status: 401 })
  }

  try {
    const [settings, url] = await Promise.all([
      getSettingsForUser(userId),
      botUrl(),
    ])
    return Response.json({
      ok: true,
      connected: Boolean(settings?.linked),
      botUrl: url,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json({ ok: false, error: 'Нужна авторизация' }, { status: 401 })
  }

  try {
    const chats = await unlinkUser(userId)
    await Promise.all(
      chats.map(chatId =>
        sendMessage(
          chatId,
          'Вы успешно отвязали ваш аккаунт English Cards, можете привязать его к другому Telegram-аккаунту.'
        ).catch(error => {
          console.error('telegram unlink message:', error)
        })
      )
    )
    return Response.json({ ok: true, unlinked: chats.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json({ ok: false, error: 'Нужна авторизация' }, { status: 401 })
  }

  try {
    const { code, expires_at } = await createLinkCode(userId)
    const url = await botUrl(code)
    if (!url) {
      return Response.json(
        { ok: false, error: 'Не удалось определить имя бота' },
        { status: 500 },
      )
    }
    return Response.json({ ok: true, code, expiresAt: expires_at, botUrl: url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
