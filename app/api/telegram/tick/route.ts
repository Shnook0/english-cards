import { sendCard } from '@/lib/telegram/bot'
import { canSendRegular, isWithinWindow } from '@/lib/telegram/schedule'
import {
  finishDelivery,
  getCard,
  listDuePending,
  listDueReviews,
  listSettings,
  markPendingSent,
  markReviewSent,
  normalizeWord,
  pickNextCard,
  updateSettings,
  type BotCard,
  type TelegramSettings,
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
  const sentKeys = new Set<string>()
  const now = new Date()

  const cardKey = (chatId: number, cardId: string) => `${chatId}:card:${cardId}`
  const wordKey = (chatId: number, word: string) => `${chatId}:word:${normalizeWord(word)}`
  const alreadySent = (chatId: number, card: { id: string; word: string }) =>
    sentKeys.has(cardKey(chatId, card.id)) || sentKeys.has(wordKey(chatId, card.word))
  const rememberSent = (chatId: number, card: { id: string; word: string }) => {
    sentKeys.add(cardKey(chatId, card.id))
    sentKeys.add(wordKey(chatId, card.word))
  }
  const markDelivered = async (chatId: number) => {
    try {
      await updateSettings(chatId, { last_sent_at: new Date().toISOString() })
    } catch (error) {
      console.error('telegram tick last_sent_at:', error)
    }
  }
  const scheduleNext = async (
    setting: TelegramSettings,
    card: BotCard,
    initialIgnore: boolean,
  ) => {
    try {
      await finishDelivery(setting.chat_id, setting.user_id, card, setting, {
        initialIgnore,
      })
    } catch (error) {
      console.error('telegram tick follow-up:', error)
    }
  }

  let settings: TelegramSettings[] = []
  try {
    settings = await listSettings()
  } catch (error) {
    console.error('telegram tick settings:', error)
    return Response.json({ ok: false, error: 'settings' }, { status: 500 })
  }

  const settingsByChat = new Map(settings.map(setting => [setting.chat_id, setting]))
  const activeChatIds = settings
    .filter(setting => !setting.paused)
    .map(setting => setting.chat_id)

  try {
    const due = await listDueReviews(activeChatIds)

    for (const review of due) {
      const setting = settingsByChat.get(review.chat_id)
      if (!setting || setting.paused || !isWithinWindow(setting, now)) continue

      const card = await getCard(review.card_id)
      if (!card) {
        await markReviewSent(review.id)
        continue
      }

      if (alreadySent(review.chat_id, card)) {
        await markReviewSent(review.id)
        continue
      }

      try {
        await sendCard(review.chat_id, card, 'review', setting)
        rememberSent(review.chat_id, card)
        sentChats.add(review.chat_id)
        await markReviewSent(review.id)
        await markDelivered(review.chat_id)
        await scheduleNext(setting, card, false)
        sent.push(`review:${card.id}`)
      } catch (error) {
        failed.push(`review:${card.id}`)
        console.error('telegram tick review:', error)
      }
    }
  } catch (error) {
    console.error('telegram tick reviews:', error)
  }

  try {
    const due = await listDuePending(activeChatIds)

    for (const pending of due) {
      const setting = settingsByChat.get(pending.chat_id)
      if (!setting || setting.paused || !isWithinWindow(setting, now)) continue

      const card = await getCard(pending.card_id)
      if (!card) {
        await markPendingSent(pending.id)
        continue
      }

      if (alreadySent(pending.chat_id, card)) {
        await markPendingSent(pending.id)
        continue
      }

      try {
        await sendCard(pending.chat_id, card, 'review', setting)
        rememberSent(pending.chat_id, card)
        sentChats.add(pending.chat_id)
        await markPendingSent(pending.id)
        await markDelivered(pending.chat_id)
        await scheduleNext(setting, card, false)
        sent.push(`review:${card.id}`)
      } catch (error) {
        failed.push(`review:${card.id}`)
        console.error('telegram tick pending:', error)
      }
    }
  } catch (error) {
    console.error('telegram tick pending:', error)
  }

  try {
    for (const setting of settings) {
      if (setting.paused) continue
      if (sentChats.has(setting.chat_id)) continue
      if (!canSendRegular(setting, now)) continue

      const last = setting.last_sent_at ? new Date(setting.last_sent_at).getTime() : 0
      if (last > 0 && now.getTime() - last < setting.interval_minutes * 60 * 1000) continue

      const card = await pickNextCard(setting.user_id, setting.chat_id)
      if (!card) continue

      try {
        await sendCard(setting.chat_id, card, 'scheduled', setting)
        await updateSettings(setting.chat_id, { last_sent_at: new Date().toISOString() })
        await scheduleNext(setting, card, true)
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
