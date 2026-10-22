import { setWebhook } from '@/lib/telegram/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const setupSecret = process.env.TELEGRAM_TICK_SECRET
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET

  if (!setupSecret) {
    return Response.json({ ok: false, error: 'TELEGRAM_TICK_SECRET не задан' }, { status: 500 })
  }
  if (!webhookSecret) {
    return Response.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET не задан' }, { status: 500 })
  }

  const url = new URL(request.url)
  if (url.searchParams.get('secret') !== setupSecret) {
    return new Response('Forbidden', { status: 403 })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || url.origin
  const webhookUrl = `${base.replace(/\/+$/, '')}/api/telegram/webhook`

  try {
    await setWebhook(webhookUrl, webhookSecret)
    return Response.json({ ok: true, webhookUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
