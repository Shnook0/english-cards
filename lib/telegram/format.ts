import type { InlineKeyboard, ReplyKeyboard } from './api'
import {
  canSendRegular,
  DONT_KNOW_STAGE_LABELS,
  formatInterval,
  IGNORED_FOLLOW_UP_STAGE,
  isWithinWindow,
  KNOWN_FOLLOW_UP_STAGE,
  MUTED_FOLLOW_UP_STAGE,
  nextScheduledAt,
  normalizeTime,
  TIMEZONE_OPTIONS,
} from './schedule'
import type {
  BotCard,
  BotStats,
  DeliveryRow,
  PendingRow,
  RevealMode,
  TelegramSettings,
  UpcomingReview,
} from './store'

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function tick(active: boolean): string {
  return active ? '✓ ' : ''
}

const INTERVAL_OPTIONS = [15, 30, 60, 120, 180] as const

export const TIME_PRESETS = [
  { code: '08-20', start: '08:00', end: '20:00', label: '08:00–20:00' },
  { code: '09-21', start: '09:00', end: '21:00', label: '09:00–21:00' },
  { code: '10-22', start: '10:00', end: '22:00', label: '10:00–22:00' },
  { code: 'all', start: '00:00', end: '23:59', label: 'Весь день' },
] as const

function statusLabel(settings: TelegramSettings): string {
  return settings.paused ? 'на паузе' : 'активен'
}

function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

const SHORT_MONTHS = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const

function formatDateWords(iso: string, timezone: string): string {
  const date = new Date(iso)
  let parts: Intl.DateTimeFormatPart[]

  try {
    parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(date)
  }

  const day = parts.find(part => part.type === 'day')?.value ?? '?'
  const month = Number(parts.find(part => part.type === 'month')?.value ?? 1) - 1
  const year = parts.find(part => part.type === 'year')?.value ?? '?'
  return `${day} ${SHORT_MONTHS[month] ?? 'мес.'} ${year}`
}

function deliveryLabel(kind: string): string {
  if (kind === 'scheduled') return 'по расписанию'
  if (kind === 'repeat') return 'повтор'
  if (kind === 'review') return 'повтор'
  if (kind === 'manual') return 'вручную'
  return kind
}

function reviewLabel(stage: number): string {
  return DONT_KNOW_STAGE_LABELS[stage] ?? 'повтор'
}

function followUpLabel(stage: number | null): string {
  if (stage === null) return 'по расписанию'
  if (stage >= MUTED_FOLLOW_UP_STAGE) return 'отложенный повтор'
  if (stage >= IGNORED_FOLLOW_UP_STAGE) return 'после игнора'
  if (stage >= KNOWN_FOLLOW_UP_STAGE) return 'после «Знаю»'
  return reviewLabel(stage)
}

function followUpTitle(stage: number | null, word: string): string {
  if (stage !== null && stage >= MUTED_FOLLOW_UP_STAGE) {
    return `Отложенный повтор: ${word}`
  }
  if (stage !== null && stage >= IGNORED_FOLLOW_UP_STAGE) {
    return `Повтор после игнора: ${word}`
  }
  if (stage !== null && stage >= KNOWN_FOLLOW_UP_STAGE) {
    return `Повтор «Знаю»: ${word}`
  }
  return `Повтор «Не знаю»: ${word}`
}

function debugReason(
  settings: TelegramSettings,
  pending: PendingRow[],
  reviews: UpcomingReview[],
  stats: BotStats,
  now: number
): string {
  if (settings.paused) return 'бот на паузе.'

  const nowDate = new Date(now)
  const inWindow = canSendRegular(settings, nowDate)
  const dueReview = [...pending, ...reviews].some(
    item => new Date(item.due_at).getTime() <= now
  )
  if (dueReview) {
    if (!inWindow) {
      return 'есть запланированный повтор, но сейчас вне окна — придёт при открытии окна.'
    }
    return 'есть повтор, который уже должен был прийти. Если его нет — cron-job.org не запускается или неверный TELEGRAM_TICK_SECRET.'
  }

  if (!inWindow) {
    return 'сейчас вне окна отправки — обычные слова и повторы ждут открытия окна.'
  }

  if (stats.hard === 0) return 'нет слов для повторения в твоих папках.'

  if (settings.last_sent_at) {
    const last = new Date(settings.last_sent_at).getTime()
    const intervalMs = settings.interval_minutes * 60 * 1000
    if (now - last < intervalMs) {
      const left = Math.ceil((intervalMs - (now - last)) / 60000)
      return `интервал ещё не прошёл: ждать ${left} мин.`
    }
  }

  return 'всё готово к отправке. Если сообщения нет — cron-job.org не запускается.'
}

export function debugText(
  settings: TelegramSettings,
  deliveries: DeliveryRow[],
  pending: PendingRow[],
  reviews: UpcomingReview[],
  stats: BotStats
): string {
  const tz = settings.timezone
  const now = Date.now()
  const next = nextScheduledAt(settings, new Date(now))
  const nextText =
    next === null
      ? 'пауза'
      : next.getTime() <= now + 60_000
        ? 'уже пора'
        : `через ${Math.ceil((next.getTime() - now) / 60000)} мин (${formatTime(
            next.toISOString(),
            tz
          )})`

  const queue = [...pending, ...reviews].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  )
  const queueCount = stats.pending + stats.reviews

  const lines = [
    '<b>🛠 Диагностика</b>',
    '',
    `Сейчас: <b>${formatTime(new Date().toISOString(), tz)}</b> (${escapeHtml(tz)})`,
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    `Последняя отправка: <b>${
      settings.last_sent_at ? formatDateTime(settings.last_sent_at, tz) : 'ещё не было'
    }</b>`,
    `Следующая отправка: <b>${nextText}</b>`,
    `В очереди повторов: <b>${queueCount}</b>${
      queue[0] ? ` (ближайший ${formatDateTime(queue[0].due_at, tz)})` : ''
    }`,
  ]

  if (deliveries.length > 0) {
    lines.push('')
    lines.push('<b>Последние отправки</b>')
    for (const delivery of deliveries) {
      lines.push(
        `${formatDateTime(delivery.sent_at, tz)} — ${escapeHtml(
          deliveryLabel(delivery.kind)
        )}`
      )
    }
  }

  lines.push('')
  lines.push(
    `<b>Причина:</b> ${debugReason(settings, pending, reviews, stats, now)}`
  )

  return lines.join('\n')
}

export function debugKeyboard(): InlineKeyboard {
  return [
    [
      { text: 'Последние', callback_data: 'set:debug' },
      { text: 'Следующие', callback_data: 'set:upcoming' },
    ],
    [
      { text: 'Обновить', callback_data: 'set:debug' },
      { text: 'Настройки', callback_data: 'set:menu' },
    ],
  ]
}

type UpcomingKind = 'review' | 'regular'

type UpcomingItem = {
  at: string
  label: string
  detail: string
  kind: UpcomingKind
}

function regularUpcomingItems(
  settings: TelegramSettings,
  now: Date,
  count: number
): UpcomingItem[] {
  if (settings.paused || count <= 0) return []

  const intervalMs = settings.interval_minutes * 60 * 1000
  const lastSent = settings.last_sent_at
    ? new Date(settings.last_sent_at).getTime()
    : Number.NaN
  const due = Number.isFinite(lastSent)
    ? Math.max(lastSent + intervalMs, now.getTime())
    : now.getTime()

  return Array.from({ length: count }, (_, index) => ({
    at: new Date(due + intervalMs * index).toISOString(),
    label: 'Обычная отправка из папки',
    detail: 'по интервалу',
    kind: 'regular' as const,
  }))
}

function upcomingState(
  settings: TelegramSettings,
  item: UpcomingItem,
  now: Date
): string {
  if (settings.paused) return 'на паузе'

  const at = new Date(item.at)
  const overdue = at.getTime() <= now.getTime()

  if (item.kind === 'review') {
    if (!overdue) return 'по расписанию'
    return isWithinWindow(settings, now) ? 'готова к отправке' : 'ждёт открытия окна'
  }

  const allowedAt = canSendRegular(settings, at)
  const allowedNow = canSendRegular(settings, now)

  if (overdue) return allowedNow ? 'готова к отправке' : 'ждёт окно'
  return allowedAt ? 'не ждёт окно' : 'ждёт окно'
}

export function upcomingText(
  settings: TelegramSettings,
  pending: PendingRow[],
  reviews: UpcomingReview[]
): string {
  const tz = settings.timezone
  const now = new Date()

  const reviewItems: UpcomingItem[] = [
    ...reviews.map(review => ({
      at: review.due_at,
      label: followUpTitle(review.stage, review.word),
      detail: followUpLabel(review.stage),
      kind: 'review' as const,
    })),
    ...pending.map(item => ({
      at: item.due_at,
      label: followUpTitle(item.stage, item.word),
      detail: followUpLabel(item.stage),
      kind: 'review' as const,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const regularItems = regularUpcomingItems(settings, now, 3)

  const lines = [
    '<b>🗓 Следующие отправки</b>',
    '',
    `Сейчас: <b>${formatTime(now.toISOString(), tz)}</b> (${escapeHtml(tz)})`,
    `Режим: <b>${
      settings.paused ? 'пауза' : isWithinWindow(settings, now) ? 'окно открыто' : 'вне окна'
    }</b>`,
    '',
  ]

  const renderItems = (items: UpcomingItem[], limit: number) => {
    for (const [index, item] of items.slice(0, limit).entries()) {
      lines.push(
        `${index + 1}) <b>${formatDateWords(item.at, tz)}, ${formatTime(item.at, tz)}</b>`
      )
      lines.push(
        `${escapeHtml(item.label)} <i>(${escapeHtml(item.detail)})</i>`
      )
      lines.push(`Состояние: <b>${upcomingState(settings, item, now)}</b>`)
      lines.push('')
    }
    if (items.length > limit) {
      lines.push(`… и ещё ${items.length - limit}`)
      lines.push('')
    }
  }

  lines.push('<b>🔁 Повторы</b>')
  if (reviewItems.length === 0) {
    lines.push('пока нет запланированных повторов.')
    lines.push('')
  } else {
    renderItems(reviewItems, 5)
  }

  if (regularItems.length > 0) {
    lines.push('<b>📚 Обычные отправки</b>')
    renderItems(regularItems, 3)
  }

  lines.push(
    '<i>Все отправки приходят только в окне. Повторы, выпавшие вне окна, переносятся на следующее открытие.</i>'
  )

  return lines.join('\n')
}

export function upcomingKeyboard(): InlineKeyboard {
  return [
    [
      { text: 'Последние', callback_data: 'set:debug' },
      { text: 'Обновить', callback_data: 'set:upcoming' },
    ],
    [
      { text: 'Прислать слово', callback_data: 'set:next' },
      { text: 'Настройки', callback_data: 'set:menu' },
    ],
  ]
}

export function settingsText(settings: TelegramSettings): string {
  return [
    '<b>⚙️ Настройки бота</b>',
    '',
    `⏰ Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `🔁 Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `👀 Формат: <b>${settings.reveal_mode === 'spoiler' ? 'перевод скрыт' : 'перевод виден'}</b>`,
    `📌 Статус: <b>${statusLabel(settings)}</b>`,
    `🌍 Часовой пояс: <b>${escapeHtml(settings.timezone)}</b>`,
    '',
    '<i>Обычные слова приходят только в окне.</i>',
    '<i>«Не знаю»: 15 минут, 2 и 5 часов, затем 1, 2, 4, 7, 15 и 30 дней.</i>',
    '<i>«Знаю»: через 4 дня, затем реже. Без ответа — через 1–2 дня, затем реже.</i>',
    '<i>Повторы, выпавшие вне окна, переносятся на следующее открытие.</i>',
  ].join('\n')
}

export function settingsKeyboard(settings: TelegramSettings): InlineKeyboard {
  return [
    [
      { text: 'Интервал', callback_data: 'set:interval' },
      { text: 'Время', callback_data: 'set:time' },
    ],
    [
      {
        text: settings.paused ? 'Продолжить' : 'Пауза',
        callback_data: 'set:toggle',
      },
      { text: 'Статистика', callback_data: 'set:stats' },
    ],
    [
      { text: 'Формат перевода', callback_data: 'set:fmt' },
      { text: 'Часовой пояс', callback_data: 'set:tz' },
    ],
    [
      { text: 'Обновить', callback_data: 'set:menu' },
      { text: 'Прислать слово сейчас', callback_data: 'set:next' },
    ],
  ]
}

export function welcomeText(settings: TelegramSettings): string {
  return [
    '<b>📚 English Cards</b>',
    '',
    'Здравствуйте! Я бот для повторения английских слов.',
    'Присылаю слова из ваших папок — новые и те, где были ошибки.',
    '',
    '<b>Сейчас</b>',
    `⏰ Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b> — время, когда приходят слова.`,
    `🔁 Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b> — пауза между обычными словами.`,
    `📌 Статус: <b>${statusLabel(settings)}</b>`,
    '',
    '<b>Как работают кнопки</b>',
    '• «Знаю» — верну слово через 4 дня, затем реже.',
    '• «Не знаю» — верну через 15 минут, 2 и 5 часов, затем через 1, 2, 4, 7, 15 и 30 дней.',
    '• Если не нажать кнопку, повторю через 1–2 дня, затем реже.',
    '• «Пропустить» — то же, что не нажать кнопку.',
    '• «Больше не повторять» — уберу из обычной очереди, но напомню через 30 и 70 дней.',
    '',
    'Обычные слова приходят только в окне. Повторы, выпавшие вне окна, переносятся на следующее открытие.',
    '',
    'Если нужна помощь, отправьте /help.',
    '',
    '<i>Настроить всё можно кнопками ниже или командой /settings.</i>',
  ].join('\n')
}

export function mainReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: 'Слово' }],
      [{ text: 'Настройки' }, { text: 'Статистика' }],
      [{ text: 'Диагностика' }, { text: 'Помощь' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие или напиши команду',
  }
}

export function helpKeyboard(): InlineKeyboard {
  return [
    [{ text: 'Настройки', callback_data: 'set:menu' }],
    [{ text: 'Прислать слово сейчас', callback_data: 'set:next' }],
  ]
}

export function intervalText(settings: TelegramSettings): string {
  return [
    '<b>Интервал отправки</b>',
    '',
    `Сейчас: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    '',
    '<i>Выбери готовый вариант или задай своё количество минут.</i>',
  ].join('\n')
}

export function intervalKeyboard(settings: TelegramSettings): InlineKeyboard {
  const buttons = INTERVAL_OPTIONS.map(minutes => ({
    text: `${tick(minutes === settings.interval_minutes)}${formatInterval(minutes)}`,
    callback_data: `set:iv:${minutes}`,
  }))

  return [
    buttons.slice(0, 3),
    buttons.slice(3),
    [{ text: 'Самому выбрать время', callback_data: 'set:ivc' }],
    [{ text: 'Назад', callback_data: 'set:menu' }],
  ]
}

export const CUSTOM_INTERVAL_PROMPT =
  'Жду число минут. Отправь его одним сообщением, например 45.'

export function customIntervalText(settings: TelegramSettings): string {
  return [
    '<b>Свой интервал</b>',
    '',
    `Сейчас: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    '',
    'Напиши количество минут числом, например <b>5</b> или <b>45</b>.',
    'Допустимо от 5 до 1440 минут.',
  ].join('\n')
}

export function customIntervalKeyboard(): InlineKeyboard {
  return [[{ text: 'Отмена', callback_data: 'set:interval' }]]
}

export function formatText(settings: TelegramSettings): string {
  return [
    '<b>Формат напоминаний</b>',
    '',
    'Перевод можно показывать сразу или скрывать под спойлером.',
    '',
    `Сейчас: <b>${
      settings.reveal_mode === 'spoiler' ? 'перевод скрыт' : 'перевод виден'
    }</b>`,
    '',
    '<i>Спойлер открывается нажатием на перевод.</i>',
  ].join('\n')
}

export function formatKeyboard(settings: TelegramSettings): InlineKeyboard {
  return [
    [
      {
        text: `${tick(settings.reveal_mode === 'open')}Перевод виден`,
        callback_data: 'set:fmt:open',
      },
    ],
    [
      {
        text: `${tick(settings.reveal_mode === 'spoiler')}Перевод скрыт`,
        callback_data: 'set:fmt:spoiler',
      },
    ],
    [{ text: 'Назад', callback_data: 'set:menu' }],
  ]
}

export function timeText(settings: TelegramSettings): string {
  return [
    '<b>Окно отправки</b>',
    '',
    `Сейчас: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    '',
    '<i>Выбери готовый вариант или настрой вручную.</i>',
  ].join('\n')
}

export function timeKeyboard(settings: TelegramSettings): InlineKeyboard {
  const start = normalizeTime(settings.window_start)
  const end = normalizeTime(settings.window_end)

  const presetButtons = TIME_PRESETS.map(preset => ({
    text: `${tick(start === preset.start && end === preset.end)}${preset.label}`,
    callback_data: `set:tw:${preset.code}`,
  }))

  return [
    presetButtons.slice(0, 2),
    presetButtons.slice(2),
    [{ text: 'Настроить вручную', callback_data: 'set:tw:f' }],
    [{ text: 'Назад', callback_data: 'set:menu' }],
  ]
}

export function timeFineText(settings: TelegramSettings): string {
  return [
    '<b>Точная настройка окна</b>',
    '',
    `Начало: <b>${normalizeTime(settings.window_start)}</b>`,
    `Конец: <b>${normalizeTime(settings.window_end)}</b>`,
    '',
    '<i>Меняй кнопками — изменения сохраняются сразу.</i>',
  ].join('\n')
}

export function timeFineKeyboard(): InlineKeyboard {
  return [
    [
      { text: 'Начало −30 мин', callback_data: 'set:ts:-30' },
      { text: 'Начало +30 мин', callback_data: 'set:ts:30' },
    ],
    [
      { text: 'Конец −30 мин', callback_data: 'set:te:-30' },
      { text: 'Конец +30 мин', callback_data: 'set:te:30' },
    ],
    [
      { text: 'Начало −1 ч', callback_data: 'set:ts:-60' },
      { text: 'Начало +1 ч', callback_data: 'set:ts:60' },
    ],
    [
      { text: 'Конец −1 ч', callback_data: 'set:te:-60' },
      { text: 'Конец +1 ч', callback_data: 'set:te:60' },
    ],
    [
      { text: 'Готово', callback_data: 'set:menu' },
      { text: 'Назад', callback_data: 'set:time' },
    ],
  ]
}

export function timezoneText(settings: TelegramSettings): string {
  return [
    '<b>Часовой пояс</b>',
    '',
    `Сейчас: <b>${escapeHtml(settings.timezone)}</b>`,
    '',
    '<i>Окно отправки работает по этому времени.</i>',
  ].join('\n')
}

export function timezoneKeyboard(settings: TelegramSettings): InlineKeyboard {
  const buttons = TIMEZONE_OPTIONS.map(option => ({
    text: `${tick(option.tz === settings.timezone)}${option.label}`,
    callback_data: `set:tz:${option.code}`,
  }))

  return [
    buttons.slice(0, 2),
    buttons.slice(2, 4),
    buttons.slice(4),
    [{ text: 'Назад', callback_data: 'set:menu' }],
  ]
}

export function statsText(stats: BotStats): string {
  return [
    '<b>📊 Статистика</b>',
    '',
    `Сложных слов: <b>${stats.hard}</b>`,
    `Всего слов: <b>${stats.total}</b>`,
    `В очереди повторов: <b>${stats.pending + stats.reviews}</b>`,
    `Отправлено за 7 дней: <b>${stats.sentWeek}</b>`,
  ].join('\n')
}

export function statsKeyboard(): InlineKeyboard {
  return [
    [
      { text: 'Прислать слово', callback_data: 'set:next' },
      { text: 'Назад', callback_data: 'set:menu' },
    ],
  ]
}

export function cardText(card: BotCard, mode: RevealMode = 'open'): string {
  const translation =
    mode === 'spoiler'
      ? `<tg-spoiler>${escapeHtml(card.translation)}</tg-spoiler>`
      : escapeHtml(card.translation)
  const lines: string[] = []
  lines.push(`<b>${escapeHtml(card.word.trim().toUpperCase())}</b> - ${translation}`)

  const sentences = (card.sentences ?? [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)

  if (sentences.length > 0) {
    lines.push('')
    lines.push('Примеры:')
    for (const sentence of sentences) {
      lines.push(`• ${escapeHtml(truncate(sentence, 350))}`)
    }
  }

  lines.push('')
  lines.push(`Папка: «${escapeHtml(card.folder_name)}»`)

  return lines.join('\n')
}

export function cardKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: 'Знаю', callback_data: `know:${cardId}` },
      { text: 'Не знаю', callback_data: `dont:${cardId}` },
      { text: 'Пропустить', callback_data: `skip:${cardId}` },
    ],
    [{ text: 'Больше не повторять', callback_data: `mute:${cardId}` }],
    [{ text: 'Удалить из папки', callback_data: `del:${cardId}` }],
  ]
}

export function deleteConfirmKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: 'Да, удалить', callback_data: `delyes:${cardId}` },
      { text: 'Отмена', callback_data: `delno:${cardId}` },
    ],
  ]
}
