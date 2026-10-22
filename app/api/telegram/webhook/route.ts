import { handleUpdate, type TelegramUpdate } from '@/lib/telegram/bot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!expected) {
    return Response.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET не задан' }, { status: 500 })
  }

  const actual = request.headers.get('x-telegram-bot-api-secret-token')
  if (actual !== expected) {
    return new Response('Forbidden', { status: 403 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return Response.json({ ok: false, error: 'Некорректный JSON' }, { status: 400 })
  }

  try {
    await handleUpdate(update)
  } catch (error) {
    console.error('telegram webhook:', error)
  }

  return Response.json({ ok: true })
}
