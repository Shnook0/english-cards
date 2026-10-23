import type { InlineKeyboard, ReplyKeyboard } from './api'
import {
  ACTIVITY_BONUS_MINUTES,
  canSendRegular,
  DONT_KNOW_STAGE_LABELS,
  formatInterval,
  hasActivityBonus,
  isWithinWindow,
  nextScheduledAt,
  normalizeTime,
  TIMEZONE_OPTIONS,
} from './schedule'
import type {
  BotCard,
  BotStats,
  DeliveryRow,
  PendingRow,
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
  if (kind === 'review') return 'повтор «Не знаю»'
  if (kind === 'manual') return 'вручную'
  return kind
}

function reviewLabel(stage: number): string {
  return DONT_KNOW_STAGE_LABELS[stage] ?? 'повтор'
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
  if (!canSendRegular(settings, nowDate)) {
    return 'сейчас вне окна отправки — обычные слова ждут открытия окна.'
  }

  if (!isWithinWindow(settings, nowDate) && hasActivityBonus(settings, nowDate)) {
    return `действует бонус после действия: обычные слова ещё приходят вне окна ${ACTIVITY_BONUS_MINUTES} мин.`
  }

  const duePending = pending.some(item => new Date(item.due_at).getTime() <= now)
  if (duePending) {
    return 'есть обычный повтор, который уже должен был прийти. Если его нет — cron-job.org не запускается.'
  }

  const dueReview = reviews.some(item => new Date(item.due_at).getTime() <= now)
  if (dueReview && isWithinWindow(settings, nowDate)) {
    return 'есть повтор «Не знаю», который уже должен был прийти. Если его нет — cron-job.org не запускается.'
  }

  if (stats.hard === 0) return 'нет сложных слов в твоих папках.'

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

  const bonus = hasActivityBonus(settings, new Date(now))
    ? `да, ещё ${ACTIVITY_BONUS_MINUTES} мин после действия`
    : 'нет'

  const lines = [
    '<b>Диагностика</b>',
    '',
    `Сейчас: <b>${formatTime(new Date().toISOString(), tz)}</b> (${escapeHtml(tz)})`,
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    `Последняя плановая: <b>${
      settings.last_sent_at ? formatDateTime(settings.last_sent_at, tz) : 'ещё не было'
    }</b>`,
    `Следующая плановая: <b>${nextText}</b>`,
    `Бонус после действия: <b>${bonus}</b>`,
    `Повторов «Не знаю»: <b>${reviews.length}</b>${
      reviews[0] ? ` (ближайший ${formatDateTime(reviews[0].due_at, tz)})` : ''
    }`,
    `Обычных повторов: <b>${pending.length}</b>${
      pending[0] ? ` (ближайший в ${formatTime(pending[0].due_at, tz)})` : ''
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

type UpcomingKind = 'review' | 'pending' | 'regular'

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
  const allowedAt =
    item.kind === 'review' ? isWithinWindow(settings, at) : canSendRegular(settings, at)
  const allowedNow =
    item.kind === 'review'
      ? isWithinWindow(settings, now)
      : canSendRegular(settings, now)

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

  const items: UpcomingItem[] = [
    ...reviews.map(review => ({
      at: review.due_at,
      label: `Повтор «Не знаю»: ${review.word}`,
      detail: reviewLabel(review.stage),
      kind: 'review' as const,
    })),
    ...pending.map(item => ({
      at: item.due_at,
      label: 'Обычное повторение из папки',
      detail: 'после ответа',
      kind: 'pending' as const,
    })),
    ...regularUpcomingItems(settings, now, 8),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const lines = [
    '<b>Следующие отправки</b>',
    '',
    `Сейчас: <b>${formatTime(now.toISOString(), tz)}</b> (${escapeHtml(tz)})`,
    `Режим: <b>${
      settings.paused
        ? 'пауза'
        : isWithinWindow(settings, now)
          ? 'окно открыто'
          : hasActivityBonus(settings, now)
            ? `бонус ${ACTIVITY_BONUS_MINUTES} мин`
            : 'вне окна'
    }</b>`,
    '',
  ]

  if (items.length === 0) {
    lines.push('пока нет запланированных отправок.')
  } else {
    for (const [index, item] of items.slice(0, 5).entries()) {
      lines.push(
        `${index + 1}) <b>${formatDateWords(item.at, tz)}, ${formatTime(item.at, tz)}</b>`
      )
      lines.push(
        `${escapeHtml(item.label)} <i>(${escapeHtml(item.detail)})</i>`
      )
      lines.push(`Состояние: <b>${upcomingState(settings, item, now)}</b>`)
      lines.push('')
    }
  }

  lines.push(
    '<i>«Не знаю» ждут окно. Обычные отправки — в окне и ещё 30 мин после действия.</i>'
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
    '<b>Настройки бота</b>',
    '',
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    `Часовой пояс: <b>${escapeHtml(settings.timezone)}</b>`,
    '',
    '<i>Обычные слова приходят в окне и ещё 30 мин после любого действия в боте.</i>',
    '<i>Слова «Не знаю» повторяются через 20 мин, через день и через 3 дня — только внутри окна.</i>',
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
      { text: 'Часовой пояс', callback_data: 'set:tz' },
      { text: 'Обновить', callback_data: 'set:menu' },
    ],
    [{ text: 'Прислать слово сейчас', callback_data: 'set:next' }],
  ]
}

export function welcomeText(settings: TelegramSettings): string {
  return [
    '<b>Бот подключён</b>',
    '',
    'Я присылаю сложные слова из твоих папок.',
    '',
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    '',
    '<i>Настроить можно кнопками ниже.</i>',
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
    '<b>Статистика</b>',
    '',
    `Сложных слов: <b>${stats.hard}</b>`,
    `Всего слов: <b>${stats.total}</b>`,
    `В очереди на повтор: <b>${stats.pending}</b>`,
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

export function cardText(card: BotCard): string {
  const lines: string[] = []
  lines.push(`<b>${escapeHtml(card.word.trim().toUpperCase())}</b> - ${escapeHtml(card.translation)}`)

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
