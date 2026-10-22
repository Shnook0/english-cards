import { sendCard } from '@/lib/telegram/bot'
import { isWithinWindow } from '@/lib/telegram/schedule'
import {
  getCard,
  listDuePending,
  listSettings,
  markPendingSent,
  pickNextCard,
  updateSettings,
} from '@/lib/telegram/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secret = process.env.TELEGRAM_TICK_SECRET
  if (!secret) return false

  const url = new URL(request.url)
  const provided =
    request.headers.get('x-tick-secret') ??
    url.searchParams.get('secret') ??
    (request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')

  return provided === secret
}

async function runTick(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const sent: string[] = []
  const failed: string[] = []
  const sentChats = new Set<number>()

  try {
    const due = await listDuePending()
    const seen = new Set<string>()

    for (const pending of due) {
      if (seen.has(pending.card_id)) {
        await markPendingSent(pending.id)
        continue
      }
      seen.add(pending.card_id)

      const card = await getCard(pending.card_id)
      if (!card) {
        await markPendingSent(pending.id)
        continue
      }

      try {
        await sendCard(pending.chat_id, card, 'repeat')
        await markPendingSent(pending.id)
        sentChats.add(pending.chat_id)
        sent.push(`repeat:${card.id}`)
      } catch (error) {
        failed.push(`repeat:${card.id}`)
        console.error('telegram tick repeat:', error)
      }
    }
  } catch (error) {
    console.error('telegram tick pending:', error)
  }

  try {
    const settings = await listSettings()
    const now = Date.now()

    for (const setting of settings) {
      if (setting.paused) continue
      if (sentChats.has(setting.chat_id)) continue
      if (!isWithinWindow(setting)) continue

      const last = setting.last_sent_at ? new Date(setting.last_sent_at).getTime() : 0
      if (last > 0 && now - last < setting.interval_minutes * 60 * 1000) continue

      const card = await pickNextCard(setting.user_id, setting.chat_id)
      if (!card) continue

      try {
        await sendCard(setting.chat_id, card, 'scheduled')
        await updateSettings(setting.chat_id, { last_sent_at: new Date().toISOString() })
        sent.push(`scheduled:${card.id}`)
      } catch (error) {
        failed.push(`scheduled:${card.id}`)
        console.error('telegram tick scheduled:', error)
      }
    }
  } catch (error) {
    console.error('telegram tick settings:', error)
  }

  return Response.json({ ok: true, sent, failed })
}

export async function GET(request: Request): Promise<Response> {
  return runTick(request)
}

export async function POST(request: Request): Promise<Response> {
  return runTick(request)
}
