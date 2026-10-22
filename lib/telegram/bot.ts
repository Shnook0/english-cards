import { answerCallbackQuery, editMessageText, sendMessage, type InlineKeyboard } from './api'
import {
  cardKeyboard,
  cardText,
  debugKeyboard,
  debugText,
  deleteConfirmKeyboard,
  escapeHtml,
  helpKeyboard,
  intervalKeyboard,
  intervalText,
  mainReplyKeyboard,
  settingsKeyboard,
  settingsText,
  statsKeyboard,
  statsText,
  timeFineKeyboard,
  timeFineText,
  timeKeyboard,
  timeText,
  TIME_PRESETS,
  timezoneKeyboard,
  timezoneText,
  welcomeText,
} from './format'
import { syncBotMenu } from './menu'
import {
  addPendingRepeat,
  applyBotResult,
  deleteCard,
  ensureSettings,
  getCard,
  getSettings,
  getStats,
  listPendingForChat,
  listRecentDeliveries,
  pickNextCard,
  recordDelivery,
  updateSettings,
  type BotCard,
  type TelegramSettings,
} from './store'
import {
  formatInterval,
  normalizeTime,
  parseInterval,
  parseTimeRange,
  shiftTime,
  timezoneByCode,
} from './schedule'

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

const REPLY_BUTTON_COMMANDS: Record<string, string> = {
  'Настройки': '/settings',
  'Слово': '/next',
  'Статистика': '/stats',
  'Диагностика': '/debug',
  'Помощь': '/help',
}

function helpText(): string {
  return [
    '<b>Что я умею</b>',
    '',
    '• присылаю сложные слова из твоих папок',
    '• повторяю слова, которые ты не знаешь',
    '• показываю статистику',
    '',
    '<b>Команды</b>',
    '/settings — настройки',
    '/next — прислать слово сейчас',
    '/stats — статистика',
    '/time 09:00-21:00 — окно отправки',
    '/every 1h — интервал',
    '/pause — пауза',
    '/resume — продолжить',
    '/debug — диагностика',
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
    await sendMessage(chatId, 'Пока нет сложных слов в твоих папках.')
    return
  }
  await sendCard(chatId, card, kind)
}

async function debugView(
  settings: TelegramSettings
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const [deliveries, pending, stats] = await Promise.all([
    listRecentDeliveries(settings.chat_id, 8),
    listPendingForChat(settings.chat_id),
    getStats(settings.user_id, settings.chat_id),
  ])
  return {
    text: debugText(settings, deliveries, pending, stats),
    keyboard: debugKeyboard(),
  }
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

async function sendWelcome(chatId: number, settings: TelegramSettings): Promise<void> {
  await syncBotMenu()
  await sendMessage(chatId, welcomeText(settings), undefined, mainReplyKeyboard())
}

async function handleStart(chatId: number, arg: string): Promise<void> {
  const forced = process.env.TELEGRAM_OWNER_CHAT_ID
  if (forced) {
    if (String(forced) !== String(chatId)) {
      await sendMessage(chatId, 'Это личный бот.')
      return
    }
    const settings = await ensureSettings(chatId)
    await sendWelcome(chatId, settings)
    return
  }

  const existing = await getSettings(chatId)
  if (existing) {
    await sendWelcome(chatId, existing)
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

  const settings = await ensureSettings(chatId)
  await sendWelcome(chatId, settings)
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
      await syncBotMenu()
      await sendMessage(chatId, helpText(), undefined, mainReplyKeyboard())
      return

    case '/settings':
      await sendMessage(chatId, settingsText(settings), settingsKeyboard(settings))
      return

    case '/time': {
      if (!args) {
        await sendMessage(chatId, timeText(settings), timeKeyboard(settings))
        return
      }
      const range = parseTimeRange(args)
      if (!range) {
        await sendMessage(chatId, 'Не понял время. Пример: /time 09:00-21:00')
        return
      }
      await updateSettings(chatId, { window_start: range.start, window_end: range.end })
      const next = { ...settings, window_start: range.start, window_end: range.end }
      await sendMessage(chatId, timeText(next), timeKeyboard(next))
      return
    }

    case '/every': {
      if (!args) {
        await sendMessage(chatId, intervalText(settings), intervalKeyboard(settings))
        return
      }
      const minutes = parseInterval(args)
      if (!minutes) {
        await sendMessage(chatId, 'Не понял интервал. Пример: /every 1h или /every 30m (от 5 минут).')
        return
      }
      await updateSettings(chatId, { interval_minutes: minutes })
      const next = { ...settings, interval_minutes: minutes }
      await sendMessage(chatId, intervalText(next), intervalKeyboard(next))
      return
    }

    case '/pause':
      await updateSettings(chatId, { paused: true })
      await sendMessage(
        chatId,
        settingsText({ ...settings, paused: true }),
        settingsKeyboard({ ...settings, paused: true })
      )
      return

    case '/resume':
      await updateSettings(chatId, { paused: false })
      await sendMessage(
        chatId,
        settingsText({ ...settings, paused: false }),
        settingsKeyboard({ ...settings, paused: false })
      )
      return

    case '/next':
      await sendNextCard(chatId, settings.user_id, 'manual')
      return

    case '/stats': {
      const stats = await getStats(settings.user_id, chatId)
      await sendMessage(chatId, statsText(stats), statsKeyboard())
      return
    }

    case '/debug': {
      const view = await debugView(settings)
      await sendMessage(chatId, view.text, view.keyboard)
      return
    }

    default:
      await sendMessage(chatId, `Не понял команду.\n\n${helpText()}`, helpKeyboard())
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
    const command = REPLY_BUTTON_COMMANDS[text]
    if (!command) {
      await sendMessage(chatId, `Не понял.\n\n${helpText()}`, helpKeyboard())
      return
    }

    const { ok, settings } = await isOwner(chatId)
    if (!ok || !settings) return

    await handleCommand(chatId, settings, command, '')
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

async function handleSettingsCallback(
  query: TelegramCallbackQuery,
  settings: TelegramSettings
): Promise<void> {
  const message = query.message
  if (!message) {
    await answerCallbackQuery(query.id)
    return
  }

  const chatId = message.chat.id
  const messageId = message.message_id
  const parts = (query.data ?? '').split(':')
  const section = parts[1] ?? ''
  const value = parts[2] ?? ''

  switch (section) {
    case 'menu':
      await safeEdit(chatId, messageId, settingsText(settings), settingsKeyboard(settings))
      await answerCallbackQuery(query.id)
      return

    case 'interval':
      await safeEdit(chatId, messageId, intervalText(settings), intervalKeyboard(settings))
      await answerCallbackQuery(query.id)
      return

    case 'iv': {
      const minutes = Number(value)
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
        await answerCallbackQuery(query.id, 'Неверный интервал')
        return
      }
      await updateSettings(chatId, { interval_minutes: minutes })
      const next = { ...settings, interval_minutes: minutes }
      await safeEdit(chatId, messageId, intervalText(next), intervalKeyboard(next))
      await answerCallbackQuery(query.id, `Каждые ${formatInterval(minutes)}`)
      return
    }

    case 'time':
      await safeEdit(chatId, messageId, timeText(settings), timeKeyboard(settings))
      await answerCallbackQuery(query.id)
      return

    case 'tw': {
      if (value === 'f') {
        await safeEdit(chatId, messageId, timeFineText(settings), timeFineKeyboard())
        await answerCallbackQuery(query.id)
        return
      }

      const preset = TIME_PRESETS.find(item => item.code === value)
      if (!preset) {
        await answerCallbackQuery(query.id)
        return
      }

      await updateSettings(chatId, { window_start: preset.start, window_end: preset.end })
      const next = { ...settings, window_start: preset.start, window_end: preset.end }
      await safeEdit(chatId, messageId, timeText(next), timeKeyboard(next))
      await answerCallbackQuery(query.id, `${preset.start}–${preset.end}`)
      return
    }

    case 'ts': {
      const delta = Number(value)
      if (!Number.isFinite(delta) || delta === 0) {
        await answerCallbackQuery(query.id)
        return
      }
      const start = shiftTime(settings.window_start, delta)
      let end = normalizeTime(settings.window_end)
      if (start === end) end = shiftTime(start, 60)
      await updateSettings(chatId, { window_start: start, window_end: end })
      const next = { ...settings, window_start: start, window_end: end }
      await safeEdit(chatId, messageId, timeFineText(next), timeFineKeyboard())
      await answerCallbackQuery(query.id, `Начало: ${start}`)
      return
    }

    case 'te': {
      const delta = Number(value)
      if (!Number.isFinite(delta) || delta === 0) {
        await answerCallbackQuery(query.id)
        return
      }
      const end = shiftTime(settings.window_end, delta)
      let start = normalizeTime(settings.window_start)
      if (start === end) start = shiftTime(end, -60)
      await updateSettings(chatId, { window_start: start, window_end: end })
      const next = { ...settings, window_start: start, window_end: end }
      await safeEdit(chatId, messageId, timeFineText(next), timeFineKeyboard())
      await answerCallbackQuery(query.id, `Конец: ${end}`)
      return
    }

    case 'tz': {
      const tz = timezoneByCode(value)
      if (!tz) {
        await answerCallbackQuery(query.id)
        return
      }
      await updateSettings(chatId, { timezone: tz })
      const next = { ...settings, timezone: tz }
      await safeEdit(chatId, messageId, timezoneText(next), timezoneKeyboard(next))
      await answerCallbackQuery(query.id, tz)
      return
    }

    case 'toggle': {
      const paused = !settings.paused
      await updateSettings(chatId, { paused })
      const next = { ...settings, paused }
      await safeEdit(chatId, messageId, settingsText(next), settingsKeyboard(next))
      await answerCallbackQuery(query.id, paused ? 'Пауза включена' : 'Бот снова активен')
      return
    }

    case 'stats': {
      const stats = await getStats(settings.user_id, chatId)
      await safeEdit(chatId, messageId, statsText(stats), statsKeyboard())
      await answerCallbackQuery(query.id)
      return
    }

    case 'debug': {
      const view = await debugView(settings)
      await safeEdit(chatId, messageId, view.text, view.keyboard)
      await answerCallbackQuery(query.id)
      return
    }

    case 'next':
      await sendNextCard(chatId, settings.user_id, 'manual')
      await answerCallbackQuery(query.id, 'Отправил слово')
      return

    case 'help':
      await safeEdit(chatId, messageId, helpText(), helpKeyboard())
      await answerCallbackQuery(query.id)
      return

    default:
      await answerCallbackQuery(query.id)
  }
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
  const [action] = data.split(':')

  if (!action) {
    await answerCallbackQuery(query.id)
    return
  }

  const { ok, settings } = await isOwner(chatId)
  if (!ok || !settings) {
    await answerCallbackQuery(query.id, 'Нет доступа')
    return
  }

  if (action === 'set') {
    await handleSettingsCallback(query, settings)
    return
  }

  const cardId = data.slice(action.length + 1)
  if (!cardId) {
    await answerCallbackQuery(query.id)
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
