import type { InlineKeyboard, ReplyKeyboard } from './api'
import {
  canSendRegular,
  DONT_KNOW_GAP_OPTIONS,
  dontKnowGapMinutes,
  dontKnowGapMs,
  DONT_KNOW_STAGE_LABELS,
  formatInterval,
  IGNORED_FOLLOW_UP_STAGE,
  isWithinWindow,
  KNOWN_FOLLOW_UP_STAGE,
  MUTED_FOLLOW_UP_STAGE,
  SITE_FOLLOW_UP_STAGE,
  nextScheduledAt,
  normalizeTime,
  TIMEZONE_OPTIONS,
} from './schedule'
import type {
  BotCard,
  BotStats,
  DeliveryRow,
  PendingRow,
  QueueSummary,
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
  if (kind === 'scheduled') return 'новое слово из папки'
  if (kind === 'folder') return 'повтор из папки'
  if (kind === 'dontknow') return 'слово, на которое вы нажали «Не знаю»'
  // Отправки до разделения на «Не знаю» и повторы из папок различить нельзя
  if (kind === 'repeat' || kind === 'review') return 'повтор (до обновления)'
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
  if (stage === SITE_FOLLOW_UP_STAGE) return 'обычный повтор'
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
  if (stage === SITE_FOLLOW_UP_STAGE) {
    return `Обычный повтор: ${word}`
  }
  if (stage !== null && stage >= KNOWN_FOLLOW_UP_STAGE) {
    return `Повтор «Знаю»: ${word}`
  }
  return `Повтор «Не знаю»: ${word}`
}

function debugReason(
  settings: TelegramSettings,
  queue: QueueSummary,
  lastDontKnowAt: number,
  stats: BotStats,
  now: number
): string {
  if (settings.paused) return 'бот на паузе.'

  const nowDate = new Date(now)
  const inWindow = canSendRegular(settings, nowDate)
  const dueTotal = queue.dontKnow.due + queue.folder.due
  if (dueTotal > 0 && !inWindow) {
    return 'есть запланированные повторы, но сейчас вне окна — придут при открытии окна.'
  }
  if (!inWindow) {
    return 'сейчас вне окна отправки — обычные слова и повторы ждут открытия окна.'
  }

  const notes: string[] = []

  if (queue.dontKnow.due > 0) {
    const left = Math.ceil((dontKnowGapMs(settings) - (now - lastDontKnowAt)) / 60000)
    notes.push(
      left > 0
        ? `«Не знаю»: ждёт ${queue.dontKnow.due} слов, следующее придёт примерно через ${left} мин (пауза между ними ${formatInterval(dontKnowGapMinutes(settings))}).`
        : `«Не знаю»: ждёт ${queue.dontKnow.due} слов, придёт на ближайшем запуске бота.`
    )
  }

  const folderWaiting = queue.folder.due > 0 || stats.hard > 0
  if (folderWaiting) {
    const last = settings.last_sent_at ? new Date(settings.last_sent_at).getTime() : 0
    const intervalMs = settings.interval_minutes * 60 * 1000
    if (last > 0 && now - last < intervalMs) {
      const left = Math.ceil((intervalMs - (now - last)) / 60000)
      notes.push(`из папок: интервал ещё не прошёл, ждать ${left} мин.`)
    } else {
      notes.push('из папок: готово к отправке на ближайшем запуске бота.')
    }
  } else {
    notes.push('в папках нет слов для повторения.')
  }

  return notes.join(' ')
}

export function debugText(
  settings: TelegramSettings,
  deliveries: DeliveryRow[],
  queue: QueueSummary,
  lastDontKnowAt: number,
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

  const group = (title: string, item: QueueSummary['dontKnow']) =>
    `${title}: <b>${item.count}</b>${
      item.nextDueAt ? ` (ближайший ${formatDateTime(item.nextDueAt, tz)})` : ''
    }`

  const lines = [
    '<b>🛠 Диагностика</b>',
    '',
    `Сейчас: <b>${formatTime(new Date().toISOString(), tz)}</b> (${escapeHtml(tz)})`,
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    '',
    '<b>Слова и повторы из папок</b>',
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Последняя отправка: <b>${
      settings.last_sent_at ? formatDateTime(settings.last_sent_at, tz) : 'ещё не было'
    }</b>`,
    `Следующая отправка: <b>${nextText}</b>`,
    group('Повторы из папок в очереди', queue.folder),
    '',
    '<b>Слова, на которые вы нажали «Не знаю»</b>',
    `Не зависят от интервала, приходят не чаще раза в ${formatInterval(dontKnowGapMinutes(settings))} (меняется в настройках)`,
    `Последняя отправка: <b>${
      lastDontKnowAt > 0 ? formatDateTime(new Date(lastDontKnowAt).toISOString(), tz) : 'ещё не было'
    }</b>`,
    group('В очереди', queue.dontKnow),
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
    `<b>Причина:</b> ${debugReason(settings, queue, lastDontKnowAt, stats, now)}`
  )

  return lines.join('\n')
}

export function debugKeyboard(): InlineKeyboard {
  return [
    [
      { text: '🕘 Последние', callback_data: 'set:debug' },
      { text: '🗓 Следующие', callback_data: 'set:upcoming' },
    ],
    [
      { text: '🔄 Обновить', callback_data: 'set:debug' },
      { text: '← Настройки', callback_data: 'set:menu' },
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
      { text: '🕘 Последние', callback_data: 'set:debug' },
      { text: '🔄 Обновить', callback_data: 'set:upcoming' },
    ],
    [
      { text: '📖 Слово', callback_data: 'set:next' },
      { text: '🏠 Меню', callback_data: 'set:home' },
    ],
  ]
}

const LINE = '━━━━━━━━━━━━━━'

function windowLabel(settings: TelegramSettings): string {
  return `${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}`
}

function statusIcon(settings: TelegramSettings): string {
  return settings.paused ? '⏸ на паузе' : '🟢 активен'
}

function revealLabel(settings: TelegramSettings): string {
  return settings.reveal_mode === 'spoiler' ? '🙈 скрыт' : '👁 виден'
}

// ───────── Главное меню ─────────

export function homeText(settings: TelegramSettings): string {
  return [
    '<b>📚 English Cards</b>',
    LINE,
    `${statusIcon(settings)}`,
    `⏰ Приношу слова: <b>${windowLabel(settings)}</b>`,
    `🔁 Не чаще, чем раз в <b>${formatInterval(settings.interval_minutes)}</b>`,
    LINE,
    '<i>Выберите действие кнопками ниже 👇</i>',
  ].join('\n')
}

export function homeKeyboard(settings: TelegramSettings): InlineKeyboard {
  return [
    [{ text: '📖 Слово прямо сейчас', callback_data: 'set:next' }],
    [
      { text: '📊 Прогресс', callback_data: 'set:stats' },
      { text: '🗓 Расписание', callback_data: 'set:upcoming' },
    ],
    [
      { text: '⚙️ Настройки', callback_data: 'set:menu' },
      {
        text: settings.paused ? '▶️ Продолжить' : '⏸ Пауза',
        callback_data: 'set:toggle:home',
      },
    ],
    [
      { text: '❓ Как работает бот', callback_data: 'set:help' },
    ],
  ]
}

export function welcomeText(settings: TelegramSettings): string {
  return homeText(settings)
}

export function mainReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: '📖 Слово' }],
      [{ text: '📊 Прогресс' }, { text: '🗓 Расписание' }],
      [{ text: '⚙️ Настройки' }, { text: '❓ Помощь' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выберите действие или нажмите /start',
  }
}

// ───────── Настройки ─────────

export function settingsText(settings: TelegramSettings): string {
  return [
    '<b>⚙️ Настройки</b>',
    LINE,
    `📌 Статус: <b>${statusIcon(settings)}</b>`,
    `⏰ Окно: <b>${windowLabel(settings)}</b>`,
    `🔁 Интервал: <b>раз в ${formatInterval(settings.interval_minutes)}</b>`,
    `⏳ «Не знаю»: <b>раз в ${formatInterval(dontKnowGapMinutes(settings))}</b>`,
    `🈯 Перевод: <b>${revealLabel(settings)}</b>`,
    `🌍 Часовой пояс: <b>${escapeHtml(settings.timezone)}</b>`,
    LINE,
    '<i>Нажмите на пункт, который хотите изменить. Изменения применяются сразу.</i>',
  ].join('\n')
}

export function settingsKeyboard(settings: TelegramSettings): InlineKeyboard {
  return [
    [
      { text: '⏰ Окно', callback_data: 'set:time' },
      { text: '🔁 Интервал', callback_data: 'set:interval' },
    ],
    [{ text: '⏳ Пауза «Не знаю»', callback_data: 'set:dk' }],
    [
      { text: '🈯 Перевод', callback_data: 'set:fmt' },
      { text: '🌍 Часовой пояс', callback_data: 'set:tz' },
    ],
    [
      {
        text: settings.paused ? '▶️ Продолжить' : '⏸ Пауза',
        callback_data: 'set:toggle',
      },
      { text: '🛠 Диагностика', callback_data: 'set:debug' },
    ],
    [{ text: '🏠 Главное меню', callback_data: 'set:home' }],
  ]
}

export function helpKeyboard(): InlineKeyboard {
  return [
    [
      { text: '📖 Слово', callback_data: 'set:next' },
    ],
    [
      { text: '⚙️ Настройки', callback_data: 'set:menu' },
      { text: '🏠 Меню', callback_data: 'set:home' },
    ],
  ]
}

export function intervalText(settings: TelegramSettings): string {
  return [
    '<b>🔁 Как часто присылать слова</b>',
    LINE,
    `Сейчас: <b>раз в ${formatInterval(settings.interval_minutes)}</b>`,
    '',
    'Это пауза между обычными словами. Повторы «Не знаю» приходят по своему графику — их паузу можно поменять в «⏳ Пауза «Не знаю»».',
    '',
    '<i>Выберите вариант или задайте своё число минут (от 5 до 1440).</i>',
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
    [{ text: '✏️ Своё значение', callback_data: 'set:ivc' }],
    [{ text: '← Назад', callback_data: 'set:menu' }],
  ]
}

export const CUSTOM_INTERVAL_PROMPT =
  'Жду число минут. Отправь его одним сообщением, например 45.'

export function customIntervalText(settings: TelegramSettings): string {
  return [
    '<b>✏️ Свой интервал</b>',
    LINE,
    `Сейчас: <b>раз в ${formatInterval(settings.interval_minutes)}</b>`,
    '',
    'Напишите количество минут числом, например <b>5</b> или <b>45</b>.',
    '<i>Допустимо от 5 до 1440 минут.</i>',
  ].join('\n')
}

export function customIntervalKeyboard(): InlineKeyboard {
  return [[{ text: '✖️ Отмена', callback_data: 'set:interval' }]]
}

// ───────── Пауза между словами «Не знаю» ─────────

export function dontKnowGapText(
  settings: TelegramSettings,
  waiting: number | null = null,
  notice: string | null = null,
): string {
  return [
    '<b>⏳ Пауза между словами «Не знаю»</b>',
    LINE,
    `Сейчас: <b>одно слово раз в ${formatInterval(dontKnowGapMinutes(settings))}</b>`,
    ...(waiting !== null ? [`В очереди «Не знаю» сейчас: <b>${waiting}</b>`] : []),
    '',
    'Если «Не знаю» накопилось много — увеличьте паузу, чтобы они не сыпались подряд. Если хотите разобрать их быстрее — уменьшите.',
    'Обычные слова из папок идут по своему интервалу и от этой паузы не зависят.',
    ...(notice ? ['', notice] : []),
    '',
    '<i>Выберите вариант или задайте своё число минут (от 1 до 1440).</i>',
  ].join('\n')
}

export function dontKnowGapKeyboard(settings: TelegramSettings): InlineKeyboard {
  const current = dontKnowGapMinutes(settings)
  const buttons = DONT_KNOW_GAP_OPTIONS.map(minutes => ({
    text: `${tick(minutes === current)}${formatInterval(minutes)}`,
    callback_data: `set:dkv:${minutes}`,
  }))

  return [
    buttons.slice(0, 4),
    buttons.slice(4, 8),
    buttons.slice(8),
    [{ text: '✏️ Своё значение', callback_data: 'set:dkc' }],
    [{ text: '← Назад', callback_data: 'set:menu' }],
  ]
}

export const CUSTOM_DONT_KNOW_GAP_PROMPT =
  'Жду паузу для «Не знаю» в минутах. Отправь число одним сообщением, например 25.'

export function customDontKnowGapText(settings: TelegramSettings): string {
  return [
    '<b>✏️ Своя пауза для «Не знаю»</b>',
    LINE,
    `Сейчас: <b>раз в ${formatInterval(dontKnowGapMinutes(settings))}</b>`,
    '',
    'Напишите количество минут числом, например <b>25</b> или <b>90</b>. Можно и так: <b>2 ч</b>.',
    '<i>Допустимо от 1 до 1440 минут.</i>',
  ].join('\n')
}

export function customDontKnowGapKeyboard(): InlineKeyboard {
  return [[{ text: '✖️ Отмена', callback_data: 'set:dk' }]]
}

export const DONT_KNOW_GAP_NEEDS_SQL =
  '⚠️ Не сохранилось: в базе ещё нет нужной колонки. Выполните один раз supabase/dont-know-gap.sql в Supabase SQL Editor.'

export function formatText(settings: TelegramSettings): string {
  return [
    '<b>🈯 Как показывать перевод</b>',
    LINE,
    `Сейчас: <b>${revealLabel(settings)}</b>`,
    '',
    '👁 <b>Виден</b> — перевод сразу под словом.',
    '🙈 <b>Скрыт</b> — сначала вспомните сами, а потом коснитесь перевода, чтобы проверить себя. Так запоминается лучше.',
  ].join('\n')
}

export function formatKeyboard(settings: TelegramSettings): InlineKeyboard {
  return [
    [
      {
        text: `${tick(settings.reveal_mode === 'open')}👁 Перевод виден`,
        callback_data: 'set:fmt:open',
      },
    ],
    [
      {
        text: `${tick(settings.reveal_mode === 'spoiler')}🙈 Перевод скрыт`,
        callback_data: 'set:fmt:spoiler',
      },
    ],
    [{ text: '← Назад', callback_data: 'set:menu' }],
  ]
}

export function timeText(settings: TelegramSettings): string {
  return [
    '<b>⏰ Окно отправки</b>',
    LINE,
    `Сейчас: <b>${windowLabel(settings)}</b>`,
    '',
    'Только в эти часы я присылаю слова. Всё, что выпало на ночь, перенесётся на утро.',
    '',
    '<i>Выберите вариант или настройте вручную.</i>',
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
    [{ text: '🎚 Настроить вручную', callback_data: 'set:tw:f' }],
    [{ text: '← Назад', callback_data: 'set:menu' }],
  ]
}

export function timeFineText(settings: TelegramSettings): string {
  return [
    '<b>🎚 Точная настройка окна</b>',
    LINE,
    `🌅 Начало: <b>${normalizeTime(settings.window_start)}</b>`,
    `🌙 Конец: <b>${normalizeTime(settings.window_end)}</b>`,
    '',
    '<i>Меняйте кнопками — всё сохраняется сразу.</i>',
  ].join('\n')
}

export function timeFineKeyboard(): InlineKeyboard {
  return [
    [
      { text: '🌅 −30 мин', callback_data: 'set:ts:-30' },
      { text: '🌅 +30 мин', callback_data: 'set:ts:30' },
    ],
    [
      { text: '🌙 −30 мин', callback_data: 'set:te:-30' },
      { text: '🌙 +30 мин', callback_data: 'set:te:30' },
    ],
    [
      { text: '🌅 −1 ч', callback_data: 'set:ts:-60' },
      { text: '🌅 +1 ч', callback_data: 'set:ts:60' },
    ],
    [
      { text: '🌙 −1 ч', callback_data: 'set:te:-60' },
      { text: '🌙 +1 ч', callback_data: 'set:te:60' },
    ],
    [
      { text: '✅ Готово', callback_data: 'set:menu' },
      { text: '← Назад', callback_data: 'set:time' },
    ],
  ]
}

export function timezoneText(settings: TelegramSettings): string {
  return [
    '<b>🌍 Часовой пояс</b>',
    LINE,
    `Сейчас: <b>${escapeHtml(settings.timezone)}</b>`,
    '',
    'По этому времени работает окно отправки. Выберите свой город:',
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
    [{ text: '← Назад', callback_data: 'set:menu' }],
  ]
}

export function statsText(stats: BotStats): string {
  return [
    '<b>📊 Прогресс</b>',
    LINE,
    `🔥 Сложных слов: <b>${stats.hard}</b>`,
    `📚 Всего слов: <b>${stats.total}</b>`,
    `🔁 В очереди повторов: <b>${stats.pending + stats.reviews}</b>`,
    `📬 Отправлено за 7 дней: <b>${stats.sentWeek}</b>`,
    LINE,
    '<i>«Сложные» — слова с ошибками и те, что ещё не выучены.</i>',
  ].join('\n')
}

export function statsKeyboard(): InlineKeyboard {
  return [
    [
      { text: '📖 Слово', callback_data: 'set:next' },
      { text: '🗓 Расписание', callback_data: 'set:upcoming' },
    ],
    [{ text: '🏠 Главное меню', callback_data: 'set:home' }],
  ]
}

// ───────── Карточка слова ─────────

export function cardText(card: BotCard, mode: RevealMode = 'open'): string {
  const translation =
    mode === 'spoiler'
      ? `<tg-spoiler>${escapeHtml(card.translation)}</tg-spoiler>`
      : escapeHtml(card.translation)
  const lines: string[] = []
  lines.push(`📖 <b>${escapeHtml(card.word.trim().toUpperCase())}</b>`)
  lines.push(`🇷🇺 ${translation}`)

  const sentences = (card.sentences ?? [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)

  if (sentences.length > 0) {
    lines.push('')
    lines.push('💬 <b>Примеры</b>')
    for (const sentence of sentences) {
      lines.push(`• ${escapeHtml(truncate(sentence, 350))}`)
    }
  }

  lines.push('')
  lines.push(`📁 «${escapeHtml(card.folder_name)}»`)

  return lines.join('\n')
}

export function cardKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: '✅ Знаю', callback_data: `know:${cardId}` },
      { text: '❌ Не знаю', callback_data: `dont:${cardId}` },
    ],
    [
      { text: '⏭ Пропустить', callback_data: `skip:${cardId}` },
      { text: '🔕 Не повторять', callback_data: `mute:${cardId}` },
    ],
    [{ text: '🗑 Удалить из папки', callback_data: `del:${cardId}` }],
  ]
}

export function deleteConfirmKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: '🗑 Да, удалить', callback_data: `delyes:${cardId}` },
      { text: '← Отмена', callback_data: `delno:${cardId}` },
    ],
  ]
}
