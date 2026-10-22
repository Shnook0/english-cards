import { answerCallbackQuery, editMessageText, sendMessage, type InlineKeyboard } from './api'
import { cardKeyboard, cardText, deleteConfirmKeyboard, escapeHtml } from './format'
import {
  addPendingRepeat,
  applyBotResult,
  deleteCard,
  ensureSettings,
  getCard,
  getSettings,
  getStats,
  pickNextCard,
  recordDelivery,
  updateSettings,
  type BotCard,
  type TelegramSettings,
} from './store'
import { formatInterval, normalizeTime, parseInterval, parseTimeRange } from './schedule'

type TelegramChat = { id: number; type?: string }
type TelegramUser = { id: number; is_bot?: boolean; first_name?: string; username?: string }
type TelegramMessage = {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  text?: string
  date: number
}
type TelegramCallbackQuery = {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}
export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

function helpText(): string {
  return [
    'Слова приходят автоматически по расписанию.',
    '',
    'Команды:',
    '/settings — настройки',
    '/time 09:00-21:00 — окно отправки',
    '/every 1h — интервал',
    '/pause — пауза',
    '/resume — продолжить',
    '/next — прислать слово сейчас',
    '/stats — статистика',
  ].join('\n')
}

function settingsText(settings: TelegramSettings): string {
  return [
    `Окно: ${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)} (${settings.timezone})`,
    `Интервал: каждые ${formatInterval(settings.interval_minutes)}`,
    `Пауза: ${settings.paused ? 'да' : 'нет'}`,
  ].join('\n')
}

function parseCommand(text: string): { command: string; args: string } | null {
  if (!text.startsWith('/')) return null
  const [head, ...rest] = text.trim().split(/\s+/)
  if (!head) return null
  return {
    command: head.split('@')[0].toLowerCase(),
    args: rest.join(' '),
  }
}

async function isOwner(chatId: number): Promise<{ ok: boolean; settings: TelegramSettings | null }> {
  const forced = process.env.TELEGRAM_OWNER_CHAT_ID
  if (forced && String(forced) !== String(chatId)) {
    return { ok: false, settings: null }
  }
  if (forced) {
    return { ok: true, settings: await ensureSettings(chatId) }
  }
  const settings = await getSettings(chatId)
  return { ok: Boolean(settings), settings }
}

export async function sendCard(chatId: number, card: BotCard, kind: string): Promise<void> {
  await sendMessage(chatId, cardText(card), cardKeyboard(card.id))
  await recordDelivery(chatId, card.id, kind)
}

export async function sendNextCard(
  chatId: number,
  userId: string,
  kind: string
): Promise<void> {
  const card = await pickNextCard(userId, chatId)
  if (!card) {
    await sendMessage(chatId, 'Пока нет сложных слов для повторения.')
    return
  }
  await sendCard(chatId, card, kind)
}

async function safeEdit(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  try {
    await editMessageText(chatId, messageId, text, keyboard)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('message is not modified')) return
    try {
      await sendMessage(chatId, text, keyboard)
    } catch {
      // Сообщение могло быть удалено — новый тоже не отправился. Ничего не делаем.
    }
  }
}

async function handleStart(chatId: number, arg: string): Promise<void> {
  const forced = process.env.TELEGRAM_OWNER_CHAT_ID
  if (forced) {
    if (String(forced) !== String(chatId)) {
      await sendMessage(chatId, 'Это личный бот.')
      return
    }
    await ensureSettings(chatId)
    await sendMessage(chatId, `Бот подключён.\n\n${helpText()}`)
    return
  }

  const existing = await getSettings(chatId)
  if (existing) {
    await sendMessage(chatId, helpText())
    return
  }

  const linkCode = process.env.TELEGRAM_LINK_CODE
  if (linkCode && arg !== linkCode) {
    await sendMessage(
      chatId,
      'Чтобы подключить бота, отправь команду /start с кодом из настроек приложения.'
    )
    return
  }

  await ensureSettings(chatId)
  await sendMessage(chatId, `Бот подключён.\n\n${helpText()}`)
}

async function handleCommand(
  chatId: number,
  settings: TelegramSettings,
  command: string,
  args: string
): Promise<void> {
  switch (command) {
    case '/start':
    case '/help':
      await sendMessage(chatId, helpText())
      return

    case '/settings':
      await sendMessage(chatId, settingsText(settings))
      return

    case '/time': {
      if (!args) {
        await sendMessage(chatId, `Сейчас: ${settingsText(settings)}\n\nФормат: /time 09:00-21:00`)
        return
      }
      const range = parseTimeRange(args)
      if (!range) {
        await sendMessage(chatId, 'Не понял время. Пример: /time 09:00-21:00')
        return
      }
      await updateSettings(chatId, { window_start: range.start, window_end: range.end })
      await sendMessage(chatId, `Окно отправки: ${range.start}–${range.end}`)
      return
    }

    case '/every': {
      if (!args) {
        await sendMessage(
          chatId,
          `Сейчас: каждые ${formatInterval(settings.interval_minutes)}\n\nФормат: /every 1h или /every 30m`
        )
        return
      }
      const minutes = parseInterval(args)
      if (!minutes) {
        await sendMessage(chatId, 'Не понял интервал. Пример: /every 1h или /every 30m (от 5 минут).')
        return
      }
      await updateSettings(chatId, { interval_minutes: minutes })
      await sendMessage(chatId, `Интервал: каждые ${formatInterval(minutes)}`)
      return
    }

    case '/pause':
      await updateSettings(chatId, { paused: true })
      await sendMessage(chatId, 'Пауза включена.')
      return

    case '/resume':
      await updateSettings(chatId, { paused: false })
      await sendMessage(chatId, 'Пауза выключена.')
      return

    case '/next':
      await sendNextCard(chatId, settings.user_id, 'manual')
      return

    case '/stats': {
      const stats = await getStats(settings.user_id, chatId)
      await sendMessage(
        chatId,
        [
          `Сложных слов: ${stats.hard}`,
          `Всего слов: ${stats.total}`,
          `В очереди на повтор: ${stats.pending}`,
          `Отправлено за 7 дней: ${stats.sentWeek}`,
        ].join('\n')
      )
      return
    }

    default:
      await sendMessage(chatId, `Не понял команду.\n\n${helpText()}`)
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  try {
    await handleMessageInner(message)
  } catch (error) {
    console.error('telegram message:', error)
    const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
    await sendMessage(message.chat.id, `Ошибка: ${reason}`).catch(() => {})
  }
}

async function handleMessageInner(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id
  const text = message.text?.trim()
  if (!text) return

  const parsed = parseCommand(text)
  if (!parsed) {
    await sendMessage(chatId, `Я понимаю только команды.\n\n${helpText()}`)
    return
  }

  if (parsed.command === '/start') {
    await handleStart(chatId, parsed.args)
    return
  }

  const { ok, settings } = await isOwner(chatId)
  if (!ok || !settings) return

  await handleCommand(chatId, settings, parsed.command, parsed.args)
}

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
  try {
    await handleCallbackInner(query)
  } catch (error) {
    console.error('telegram callback:', error)
    await answerCallbackQuery(query.id, 'Ошибка').catch(() => {})
  }
}

async function handleCallbackInner(query: TelegramCallbackQuery): Promise<void> {
  const message = query.message
  if (!message) {
    await answerCallbackQuery(query.id)
    return
  }

  const chatId = message.chat.id
  const messageId = message.message_id
  const data = query.data ?? ''
  const [action, cardId] = data.split(':')

  if (!action || !cardId) {
    await answerCallbackQuery(query.id)
    return
  }

  const { ok, settings } = await isOwner(chatId)
  if (!ok || !settings) {
    await answerCallbackQuery(query.id, 'Нет доступа')
    return
  }

  const card = await getCard(cardId)
  if (card && card.user_id !== settings.user_id) {
    await answerCallbackQuery(query.id, 'Нет доступа')
    return
  }

  if (!card) {
    await safeEdit(chatId, messageId, 'Это слово уже удалено.', [])
    await answerCallbackQuery(query.id, 'Слово уже удалено')
    return
  }

  switch (action) {
    case 'know':
      await applyBotResult(card, true)
      await safeEdit(chatId, messageId, `${cardText(card)}\n\nОтмечено: знаю.`, [])
      await answerCallbackQuery(query.id, 'Записал')
      return

    case 'dont': {
      await applyBotResult(card, false)
      await addPendingRepeat(chatId, card.id)
      await safeEdit(
        chatId,
        messageId,
        `${cardText(card)}\n\nОтмечено: не знаю. Повторю через 15–20 минут.`,
        []
      )
      await answerCallbackQuery(query.id, 'Повторю через 15–20 минут')
      return
    }

    case 'skip':
      await safeEdit(chatId, messageId, `${cardText(card)}\n\nПропущено.`, [])
      await answerCallbackQuery(query.id, 'Пропущено')
      return

    case 'del':
      await safeEdit(
        chatId,
        messageId,
        `Удалить слово «${escapeHtml(card.word)}» из папки «${escapeHtml(card.folder_name)}»?`,
        deleteConfirmKeyboard(card.id)
      )
      await answerCallbackQuery(query.id)
      return

    case 'delyes':
      await deleteCard(card)
      await safeEdit(
        chatId,
        messageId,
        `Слово «${escapeHtml(card.word)}» удалено из папки «${escapeHtml(card.folder_name)}».`,
        []
      )
      await answerCallbackQuery(query.id, 'Удалено')
      return

    case 'delno':
      await safeEdit(chatId, messageId, cardText(card), cardKeyboard(card.id))
      await answerCallbackQuery(query.id, 'Отмена')
      return

    default:
      await answerCallbackQuery(query.id)
  }
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await handleMessage(update.message)
    return
  }
  if (update.callback_query) {
    await handleCallback(update.callback_query)
  }
}
