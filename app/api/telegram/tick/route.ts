import { sendCard } from '@/lib/telegram/bot'
import {
  canSendRegular,
  DONT_KNOW_MIN_GAP_MS,
  isWithinWindow,
} from '@/lib/telegram/schedule'
import {
  finishDelivery,
  getCard,
  getLastDontKnowSentAt,
  listDuePending,
  listDueReviews,
  listSettings,
  markPendingSent,
  markReviewSent,
  normalizeWord,
  pickNextCard,
  updateSettings,
  type BotCard,
  type DueKind,
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

type DueItem = {
  source: 'review' | 'pending'
  id: number
  user_id: string
  card_id: string
  due_at: string
}

async function runTick(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response('Forbidden', { status: 403 })
  }

  const sent: string[] = []
  const failed: string[] = []
  // Одно сообщение на чат за запуск планировщика
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

  // Слова с «Не знаю»: свой отсчёт, не зависит от интервала и не сдвигает его.
  const lastDontKnow = new Map<number, number>()
  const dontKnowReady = async (chatId: number): Promise<boolean> => {
    if (!lastDontKnow.has(chatId)) {
      lastDontKnow.set(chatId, await getLastDontKnowSentAt(chatId))
    }
    return now.getTime() - (lastDontKnow.get(chatId) ?? 0) >= DONT_KNOW_MIN_GAP_MS
  }

  // Повторы из папок и новые слова: строго по интервалу из настроек.
  const intervalReady = (setting: TelegramSettings): boolean => {
    const last = setting.last_sent_at ? new Date(setting.last_sent_at).getTime() : 0
    return !(last > 0 && now.getTime() - last < setting.interval_minutes * 60 * 1000)
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

  const settingsByUser = new Map(settings.map(setting => [setting.user_id, setting]))
  const activeUserIds = settings
    .filter(setting => !setting.paused)
    .map(setting => setting.user_id)

  // kind = 'dontknow': слова, на которые нажали «Не знаю» (не чаще раза в 7 минут,
  //                     интервал бота не учитывается и не сдвигается);
  // kind = 'folder':   плановые повторы из папок (строго по интервалу).
  const deliverDue = async (kind: DueKind) => {
    const [reviews, pending] = await Promise.all([
      listDueReviews(activeUserIds, kind),
      listDuePending(activeUserIds, kind),
    ])
    const items: DueItem[] = [
      ...reviews.map(item => ({ source: 'review' as const, ...item })),
      ...pending.map(item => ({ source: 'pending' as const, ...item })),
    ].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())

    const markSent = (item: DueItem) =>
      item.source === 'review' ? markReviewSent(item.id) : markPendingSent(item.id)

    for (const item of items) {
      const setting = settingsByUser.get(item.user_id)
      if (!setting || setting.paused || !isWithinWindow(setting, now)) continue
      if (sentChats.has(setting.chat_id)) continue

      if (kind === 'dontknow') {
        if (!(await dontKnowReady(setting.chat_id))) continue
      } else if (!intervalReady(setting)) {
        continue
      }

      const card = await getCard(item.card_id)
      if (!card || card.user_id !== setting.user_id) {
        await markSent(item)
        continue
      }

      if (alreadySent(setting.chat_id, card)) {
        await markSent(item)
        continue
      }

      try {
        await sendCard(
          setting.chat_id,
          card,
          kind === 'dontknow' ? 'dontknow' : 'folder',
          setting,
        )
        rememberSent(setting.chat_id, card)
        sentChats.add(setting.chat_id)
        await markSent(item)
        if (kind === 'dontknow') {
          lastDontKnow.set(setting.chat_id, Date.now())
        } else {
          await markDelivered(setting.chat_id)
        }
        await scheduleNext(setting, card, false)
        sent.push(`${kind}:${card.id}`)
      } catch (error) {
        failed.push(`${kind}:${card.id}`)
        console.error(`telegram tick ${kind}:`, error)
      }
    }
  }

  for (const kind of ['dontknow', 'folder'] as const) {
    try {
      await deliverDue(kind)
    } catch (error) {
      console.error(`telegram tick ${kind} queue:`, error)
    }
  }

  try {
    for (const setting of settings) {
      if (setting.paused) continue
      if (sentChats.has(setting.chat_id)) continue
      if (!canSendRegular(setting, now)) continue
      if (!intervalReady(setting)) continue

      const card = await pickNextCard(setting.user_id)
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
