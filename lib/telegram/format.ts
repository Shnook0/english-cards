import type { InlineKeyboard } from './api'
import { formatInterval, normalizeTime, TIMEZONE_OPTIONS } from './schedule'
import type { BotCard, BotStats, TelegramSettings } from './store'

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

export function settingsText(settings: TelegramSettings): string {
  return [
    '<b>Настройки бота</b>',
    '',
    `Окно: <b>${normalizeTime(settings.window_start)}–${normalizeTime(settings.window_end)}</b>`,
    `Интервал: <b>каждые ${formatInterval(settings.interval_minutes)}</b>`,
    `Статус: <b>${statusLabel(settings)}</b>`,
    `Часовой пояс: <b>${escapeHtml(settings.timezone)}</b>`,
    '',
    '<i>Слова приходят только внутри выбранного окна.</i>',
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

export function welcomeKeyboard(): InlineKeyboard {
  return [
    [{ text: 'Настроить', callback_data: 'set:menu' }],
    [{ text: 'Прислать слово сейчас', callback_data: 'set:next' }],
  ]
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
    '<i>Выбери, как часто присылать слова.</i>',
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
