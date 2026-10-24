import { answerCallbackQuery, editMessageText, sendMessage, type InlineKeyboard } from './api'
import {
  cardKeyboard,
  cardText,
  CUSTOM_INTERVAL_PROMPT,
  customIntervalKeyboard,
  customIntervalText,
  debugKeyboard,
  debugText,
  deleteConfirmKeyboard,
  escapeHtml,
  formatKeyboard,
  formatText,
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
  upcomingKeyboard,
  upcomingText,
  welcomeText,
} from './format'
import { syncBotMenu } from './menu'
import {
  applyBotResult,
  bindChatToUser,
  clearCardQueue,
  consumeLinkCode,
  deleteCard,
  ensureSettings,
  getCard,
  getCustomFolders,
  getSettings,
  getStats,
  listPendingForChat,
  listRecentDeliveries,
  listUpcomingReviews,
  muteCard,
  pickNextCard,
  recordDelivery,
  replaceDontKnowQueue,
  touchActivity,
  updateSettings,
  type BotCard,
  type RevealMode,
  type TelegramSettings,
} from './store'
import {
  buildDontKnowSchedule,
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
  reply_to_message?: TelegramMessage
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
    '• присылаю сложные слова из ваших папок на сайте',
    '• слова «Не знаю» повторяю через 15 минут, 2 и 5 часов, затем через 1, 2, 4, 7, 15 и 30 дней — в любое время, даже вне окна',
    '• могу скрыть перевод под спойлером или перестать присылать отдельное слово',
    '• показываю статистику и следующие отправки',
    '',
    '<b>Понятия</b>',
    '<b>Окно</b> — время, когда я присылаю слова. Например, 09:00–21:00.',
    '<b>Интервал</b> — пауза между обычными словами. Например, каждые 60 минут.',
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

function siteUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL
  if (!raw) return null
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withProtocol.replace(/\/+$/, '')
}

async function sendNoFolders(chatId: number): Promise<void> {
  const url = siteUrl()
  await sendMessage(
    chatId,
    [
      'Сначала создайте папку со словами на нашем сайте' + (url ? `: ${url}` : '.'),
      '',
      'После этого повторение через бота станет доступно.',
    ].join('\n'),
    url ? [[{ text: 'Открыть сайт', url }]] : undefined
  )
}

async function requireFolders(chatId: number, userId: string): Promise<boolean> {
  const folders = await getCustomFolders(userId)
  if (folders.length > 0) return true
  await sendNoFolders(chatId)
  return false
}

export async function sendCard(
  chatId: number,
  card: BotCard,
  kind: string,
  settings?: TelegramSettings
): Promise<void> {
  await sendMessage(
    chatId,
    cardText(card, settings?.reveal_mode ?? 'open'),
    cardKeyboard(card.id)
  )
  await recordDelivery(chatId, card.id, kind)
}

export async function sendNextCard(
  chatId: number,
  userId: string,
  kind: string,
  settings?: TelegramSettings
): Promise<void> {
  const folders = await getCustomFolders(userId)
  if (folders.length === 0) {
    await sendNoFolders(chatId)
    return
  }

  const card = await pickNextCard(userId, chatId)
  if (!card) {
    await sendMessage(chatId, 'Пока нет сложных слов в ваших папках.')
    return
  }
  await sendCard(chatId, card, kind, settings)
}

async function debugView(
  settings: TelegramSettings
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const [deliveries, pending, reviews, stats] = await Promise.all([
    listRecentDeliveries(settings.chat_id, 8),
    listPendingForChat(settings.chat_id),
    listUpcomingReviews(settings.chat_id, 20),
    getStats(settings.user_id, settings.chat_id),
  ])
  return {
    text: debugText(settings, deliveries, pending, reviews, stats),
    keyboard: debugKeyboard(),
  }
}

async function upcomingView(
  settings: TelegramSettings
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const [pending, reviews] = await Promise.all([
    listPendingForChat(settings.chat_id),
    listUpcomingReviews(settings.chat_id, 20),
  ])
  return {
    text: upcomingText(settings, pending, reviews),
    keyboard: upcomingKeyboard(),
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
  await touchActivity(chatId)
  await syncBotMenu()
  await sendMessage(chatId, welcomeText(settings), undefined, mainReplyKeyboard())

  const folders = await getCustomFolders(settings.user_id)
  if (folders.length === 0) {
    await sendNoFolders(chatId)
  }
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
  const code = arg.trim()

  if (code) {
    const userId = await consumeLinkCode(code)
    if (userId) {
      const bound = await bindChatToUser(chatId, userId)
      if (!bound.ok) {
        if (bound.reason === 'already_linked') {
          const account = bound.email ? ` (${escapeHtml(bound.email)})` : ''
          await sendMessage(
            chatId,
            [
              `Ваш аккаунт на сайте${account} уже привязан к другому Telegram-аккаунту.`,
              '',
              'Если хотите привязать его к этому Telegram-аккаунту, удалите привязку в личном кабинете на сайте — кнопка «Отвязать Telegram». После этого нажмите «Подключить бота» на сайте ещё раз.',
            ].join('\n')
          )
          return
        }

        await sendMessage(
          chatId,
          'Этот Telegram-аккаунт уже привязан к другому аккаунту сайта. Сначала отвяжите его в личном кабинете на сайте.'
        )
        return
      }
      await sendWelcome(chatId, bound.settings)
      return
    }
  }

  if (existing) {
    await sendWelcome(chatId, existing)
    return
  }

  const site = siteUrl()
  const siteLabel = site ? `<a href="${site}">English Cards</a>` : 'English Cards'

  await sendMessage(
    chatId,
    [
      '<b>Здравствуйте!</b>',
      '',
      'Я бот для повторения английских слов.',
      `Чтобы подключиться, откройте сайт ${siteLabel}, найдите блок «Бот в Telegram» и нажмите «Подключить бота».`,
      '',
      'После этого я смогу присылать слова из ваших папок.',
    ].join('\n')
  )
}

async function handleCustomIntervalInput(
  chatId: number,
  settings: TelegramSettings,
  text: string,
): Promise<void> {
  const minutes = parseInterval(text)
  if (!minutes) {
    await sendMessage(
      chatId,
      'Нужно число от 5 до 1440. Например: 5 или 45.',
      customIntervalKeyboard(),
    )
    return
  }

  await updateSettings(chatId, {
    interval_minutes: minutes,
    awaiting_input: null,
  })
  const next = { ...settings, interval_minutes: minutes, awaiting_input: null }
  await sendMessage(
    chatId,
    `Готово. Теперь слова приходят каждые ${formatInterval(minutes)}.\n\n${intervalText(next)}`,
    intervalKeyboard(next),
  )
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
      if (!(await requireFolders(chatId, settings.user_id))) return
      await sendMessage(chatId, settingsText(settings), settingsKeyboard(settings))
      return

    case '/time': {
      if (!(await requireFolders(chatId, settings.user_id))) return
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
      if (!(await requireFolders(chatId, settings.user_id))) return
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
      await sendNextCard(chatId, settings.user_id, 'manual', settings)
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const parts = [value.message, value.details, value.hint, value.code].filter(
      (part): part is string => typeof part === 'string' && part.length > 0
    )
    if (parts.length > 0) return parts.join(' | ')
    try {
      return JSON.stringify(error)
    } catch {
      return 'неизвестная ошибка'
    }
  }
  return String(error ?? 'неизвестная ошибка')
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  try {
    await handleMessageInner(message)
  } catch (error) {
    console.error('telegram message:', error)
    await sendMessage(message.chat.id, `Ошибка: ${describeError(error)}`).catch(() => {})
  }
}

async function handleMessageInner(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id
  const text = message.text?.trim()
  if (!text) return

  const parsed = parseCommand(text)
  if (parsed?.command === '/start') {
    await handleStart(chatId, parsed.args)
    return
  }

  const { ok, settings } = await isOwner(chatId)
  if (!ok || !settings) return

  await touchActivity(chatId)

  if (!parsed) {
    const command = REPLY_BUTTON_COMMANDS[text]
    if (!command) {
      const repliedTo = message.reply_to_message
      const isIntervalReply = Boolean(
        repliedTo?.from?.is_bot && repliedTo.text?.includes(CUSTOM_INTERVAL_PROMPT)
      )
      if (settings.awaiting_input === 'interval' || isIntervalReply) {
        await handleCustomIntervalInput(chatId, settings, text)
        return
      }
      await sendMessage(chatId, `Не понял.\n\n${helpText()}`, helpKeyboard())
      return
    }

    await handleCommand(chatId, settings, command, '')
    return
  }

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
      await updateSettings(chatId, { awaiting_input: null })
      await safeEdit(chatId, messageId, intervalText(settings), intervalKeyboard(settings))
      await answerCallbackQuery(query.id)
      return

    case 'ivc':
      await updateSettings(chatId, { awaiting_input: 'interval' })
      await safeEdit(chatId, messageId, customIntervalText(settings), customIntervalKeyboard())
      await sendMessage(chatId, CUSTOM_INTERVAL_PROMPT, undefined, {
        force_reply: true,
        input_field_placeholder: 'Число минут',
      })
      await answerCallbackQuery(query.id, 'Напиши число минут')
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

    case 'fmt': {
      const mode: RevealMode | null =
        value === 'open' ? 'open' : value === 'spoiler' ? 'spoiler' : null
      if (!mode) {
        await safeEdit(chatId, messageId, formatText(settings), formatKeyboard(settings))
        await answerCallbackQuery(query.id)
        return
      }
      await updateSettings(chatId, { reveal_mode: mode })
      const next = { ...settings, reveal_mode: mode }
      await safeEdit(chatId, messageId, formatText(next), formatKeyboard(next))
      await answerCallbackQuery(query.id, mode === 'spoiler' ? 'Перевод скрыт' : 'Перевод виден')
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

    case 'upcoming': {
      const view = await upcomingView(settings)
      await safeEdit(chatId, messageId, view.text, view.keyboard)
      await answerCallbackQuery(query.id)
      return
    }

    case 'next':
      if (!(await requireFolders(chatId, settings.user_id))) {
        await answerCallbackQuery(query.id)
        return
      }
      await sendNextCard(chatId, settings.user_id, 'manual', settings)
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
    await answerCallbackQuery(query.id, describeError(error).slice(0, 190)).catch(() => {})
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

  await touchActivity(chatId)

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
      await clearCardQueue(chatId, card.id)
      await applyBotResult(card, true)
      await safeEdit(chatId, messageId, `${cardText(card)}\n\nОтмечено: знаю.`, [])
      await answerCallbackQuery(query.id, 'Записал')
      return

    case 'dont': {
      await applyBotResult(card, false)
      await replaceDontKnowQueue(
        chatId,
        card.id,
        buildDontKnowSchedule(settings),
      )
      await safeEdit(
        chatId,
        messageId,
        [
          cardText(card),
          '',
          'Отмечено: не знаю. Ошибка записана, слово будет приходить чаще.',
          'Повторю через 15 минут, 2 и 5 часов, затем через 1, 2, 4, 7, 15 и 30 дней.',
          'Очередь повторов видна в «Диагностика» → «Следующие».',
        ].join('\n'),
        []
      )
      await answerCallbackQuery(query.id, 'Запланировал повторы')
      return
    }

    case 'mute':
      await muteCard(settings.user_id, card.id)
      await clearCardQueue(chatId, card.id)
      await safeEdit(
        chatId,
        messageId,
        `${cardText(card)}\n\nБольше не буду присылать это слово. В папке оно останется, прогресс и ошибки не изменятся.`,
        []
      )
      await answerCallbackQuery(query.id, 'Больше не повторяю')
      return

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
      await safeEdit(
        chatId,
        messageId,
        cardText(card, settings.reveal_mode),
        cardKeyboard(card.id)
      )
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
