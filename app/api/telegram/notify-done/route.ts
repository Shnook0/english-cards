import { sendMessage } from '@/lib/telegram/api'
import { listSettings } from '@/lib/telegram/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secrets = [
    process.env.TELEGRAM_TICK_SECRET,
    process.env.TELEGRAM_WEBHOOK_SECRET,
  ].filter((value): value is string => Boolean(value))

  if (secrets.length === 0) return false

  const url = new URL(request.url)
  const provided =
    request.headers.get('x-tick-secret') ??
    url.searchParams.get('secret') ??
    (request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')

  return secrets.includes(provided)
}

async function run(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const settings = await listSettings()
  if (settings.length === 0) {
    return Response.json({ ok: false, error: 'no chats' }, { status: 404 })
  }

  const sent: number[] = []
  for (const setting of settings) {
    await sendMessage(setting.chat_id, 'я все сделал')
    sent.push(setting.chat_id)
  }

  return Response.json({ ok: true, sent })
}

export async function GET(request: Request): Promise<Response> {
  return run(request)
}

export async function POST(request: Request): Promise<Response> {
  return run(request)
}
