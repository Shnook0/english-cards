import type { TelegramSettings } from './store'

export const DONT_KNOW_FIRST_MINUTES = 15
// Слова, на которые нажали «Не знаю», не зависят от интервала бота,
// но приходят не чаще, чем раз в столько минут (бот опрашивается раз в 1–2 минуты).
export const DONT_KNOW_MIN_GAP_MS = 7 * 60 * 1000

// Паузу между словами «Не знаю» можно поменять в настройках бота
// (например, растянуть, если их накопилось много).
export const DONT_KNOW_GAP_DEFAULT_MINUTES = 7
export const DONT_KNOW_GAP_OPTIONS = [3, 5, 7, 10, 15, 20, 30, 45, 60, 120] as const

export function dontKnowGapMinutes(
  settings: Pick<TelegramSettings, 'dont_know_gap_minutes'>,
): number {
  const value = Number(settings.dont_know_gap_minutes)
  if (!settings.dont_know_gap_minutes || !Number.isFinite(value) || value < 1) {
    return DONT_KNOW_GAP_DEFAULT_MINUTES
  }
  return Math.min(1440, Math.round(value))
}

export function dontKnowGapMs(settings: Pick<TelegramSettings, 'dont_know_gap_minutes'>): number {
  return dontKnowGapMinutes(settings) * 60 * 1000
}

export function normalizeTime(value: string): string {
  return value.slice(0, 5)
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = normalizeTime(value).split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`
}

export function shiftTime(value: string, deltaMinutes: number): string {
  const [hours, minutes] = normalizeTime(value).split(':').map(Number)
  const total = (((hours * 60 + minutes + deltaMinutes) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export const TIMEZONE_OPTIONS = [
  { code: 'kgd', label: 'Калининград', tz: 'Europe/Kaliningrad' },
  { code: 'msk', label: 'Москва', tz: 'Europe/Moscow' },
  { code: 'ekb', label: 'Екатеринбург', tz: 'Asia/Yekaterinburg' },
  { code: 'nsk', label: 'Новосибирск', tz: 'Asia/Novosibirsk' },
  { code: 'krsk', label: 'Красноярск', tz: 'Asia/Krasnoyarsk' },
  { code: 'vld', label: 'Владивосток', tz: 'Asia/Vladivostok' },
] as const

export function timezoneByCode(code: string): string | null {
  return TIMEZONE_OPTIONS.find(option => option.code === code)?.tz ?? null
}

export function isWithinWindow(settings: TelegramSettings, now = new Date()): boolean {
  const start = normalizeTime(settings.window_start)
  const end = normalizeTime(settings.window_end)

  let current: string
  try {
    current = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now)
  } catch {
    current = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now)
  }

  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value]),
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function safeZonedParts(date: Date, timeZone: string): ZonedParts {
  try {
    return zonedParts(date, timeZone)
  } catch {
    return zonedParts(date, 'UTC')
  }
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = safeZonedParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - date.getTime()
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = safeZonedParts(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

export function localTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hours, minutes] = normalizeTime(time).split(':').map(Number)
  const naive = Date.UTC(year, month - 1, day, hours, minutes, 0)

  let result = new Date(naive)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = new Date(naive - offsetMs(result, timeZone))
  }
  return result
}

export function nextWindowStart(settings: TelegramSettings, now = new Date()): Date {
  const dateKey = localDateKey(now, settings.timezone)
  const parts = safeZonedParts(now, settings.timezone)
  const currentMinutes = parts.hour * 60 + parts.minute
  const startMinutes = minutesFromTime(settings.window_start)

  const targetDate = currentMinutes >= startMinutes
    ? addDaysToDateKey(dateKey, 1)
    : dateKey

  return localTimeToUtc(targetDate, settings.window_start, settings.timezone)
}

export function canSendRegular(settings: TelegramSettings, now = new Date()): boolean {
  return isWithinWindow(settings, now)
}

export function clampToWindow(settings: TelegramSettings, date: Date): Date {
  if (isWithinWindow(settings, date)) return date
  return nextWindowStart(settings, date)
}

const DAY_MS = 24 * 60 * 60 * 1000

export const KNOWN_FOLLOW_UP_STAGE = 100
// stage < 100 — повторы после «Не знаю»; всё остальное — плановые повторы из папок
export function isDontKnowStage(stage: number | null | undefined): boolean {
  return typeof stage === 'number' && stage < KNOWN_FOLLOW_UP_STAGE
}
// Обычный повтор, поставленный с сайта после частых «Не знаю»
export const SITE_FOLLOW_UP_STAGE = 150
export const IGNORED_FOLLOW_UP_STAGE = 200
export const MUTED_FOLLOW_UP_STAGE = 300
export const MUTED_REPEAT_DAYS = [30, 70] as const

export function nextKnownIntervalDays(gapDays: number | null): number {
  if (gapDays === null || !Number.isFinite(gapDays) || gapDays < 1) return 4
  if (gapDays < 4) return 6
  return Math.min(365, Math.max(4, Math.round(gapDays * 2.5)))
}

export function nextIgnoredIntervalDays(gapDays: number | null): number {
  if (gapDays === null || !Number.isFinite(gapDays)) {
    return 1 + Math.floor(Math.random() * 2)
  }
  if (gapDays < 4) return 4
  return Math.min(365, Math.max(4, Math.round(gapDays * 1.5)))
}

export function followUpDueAt(
  settings: TelegramSettings,
  days: number,
  now = new Date(),
): Date {
  return clampToWindow(settings, new Date(now.getTime() + days * DAY_MS))
}

export function nextScheduledAt(
  settings: TelegramSettings,
  now = new Date(),
): Date | null {
  if (settings.paused) return null

  const intervalMs = settings.interval_minutes * 60 * 1000
  const lastSent = settings.last_sent_at ? new Date(settings.last_sent_at).getTime() : 0
  const due = lastSent > 0 ? lastSent + intervalMs : now.getTime()

  if (due > now.getTime()) return new Date(due)
  if (canSendRegular(settings, now)) return now
  return nextWindowStart(settings, now)
}

function windowPoint(settings: TelegramSettings, fraction: number): string {
  const start = minutesFromTime(settings.window_start)
  const end = minutesFromTime(settings.window_end)
  let duration = end - start
  if (duration <= 0) duration += 1440
  return timeFromMinutes(start + Math.round(duration * fraction))
}

// Этапы 0–2 общие. Этапы 3–9 — старое расписание (1, 2, 4, 7, 7, 15, 30 дней),
// их оставляем только для слов, которые уже стоят в очереди. Новое расписание — этапы 10–15.
export const DONT_KNOW_STAGE_LABELS: Record<number, string> = {
  0: 'через 15 минут',
  1: 'через 2 часа',
  2: 'через 5 часов',
  3: 'через 1 день',
  4: 'через 2 дня',
  5: 'через 4 дня',
  6: 'через 7 дней · первый раз',
  7: 'через 7 дней · второй раз',
  8: 'через 15 дней',
  9: 'через 30 дней',
  10: 'через 2 дня',
  11: 'через 3 дня',
  12: 'через 5 дней',
  13: 'через 10 дней',
  14: 'через 20 дней',
  15: 'через 30 дней',
}

export function buildDontKnowSchedule(
  settings: TelegramSettings,
  now = new Date(),
): { stage: number; dueAt: string }[] {
  const hourMs = 60 * 60 * 1000
  const result: { stage: number; dueAt: string }[] = [
    {
      stage: 0,
      dueAt: new Date(now.getTime() + DONT_KNOW_FIRST_MINUTES * 60 * 1000).toISOString(),
    },
    {
      stage: 1,
      dueAt: new Date(now.getTime() + 2 * hourMs).toISOString(),
    },
    {
      stage: 2,
      dueAt: new Date(now.getTime() + 5 * hourMs).toISOString(),
    },
  ]

  const today = localDateKey(now, settings.timezone)
  const middle = windowPoint(settings, 0.5)

  // Дальше по дням: 2, 3, 5, 10, 20 и 30 (середина окна отправки)
  for (const [days, stage] of [
    [2, 10],
    [3, 11],
    [5, 12],
    [10, 13],
    [20, 14],
    [30, 15],
  ] as const) {
    result.push({
      stage,
      dueAt: localTimeToUtc(
        addDaysToDateKey(today, days),
        middle,
        settings.timezone,
      ).toISOString(),
    })
  }

  const seen = new Set<number>()
  const scheduled: { stage: number; dueAt: string }[] = []

  for (const item of result) {
    const due = clampToWindow(settings, new Date(item.dueAt))
    const time = due.getTime()
    if (time <= now.getTime() || seen.has(time)) continue
    seen.add(time)
    scheduled.push({ stage: item.stage, dueAt: due.toISOString() })
  }

  return scheduled
}

export function parseTimeRange(input: string): { start: string; end: string } | null {
  const match = input
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return null

  const startHour = Number(match[1])
  const startMinute = Number(match[2] ?? 0)
  const endHour = Number(match[3])
  const endMinute = Number(match[4] ?? 0)
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${pad(startHour)}:${pad(startMinute)}`,
    end: `${pad(endHour)}:${pad(endMinute)}`,
  }
}

const INTERVAL_UNITS =
  'm|min|mins|minute|minutes|мин\\.?|минут[аы]?|h|hour|hours|ч|час|часа|часов'

export function parseInterval(input: string, min = 5): number | null {
  const match = input
    .trim()
    .match(new RegExp(`^(\\d+)\\s*(${INTERVAL_UNITS})?$`, 'i'))
  if (!match) return null

  const value = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  const hours = ['h', 'hour', 'hours', 'ч', 'час', 'часа', 'часов']
  const minutes = hours.includes(unit) ? value * 60 : value

  if (!Number.isFinite(minutes) || minutes < min || minutes > 1440) return null
  return minutes
}

// Пауза «Не знаю»: от 1 минуты до суток, понимает «25», «25 мин», «2 ч»
export function parseDontKnowGap(input: string): number | null {
  return parseInterval(input, 1)
}

export function formatInterval(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  return `${minutes} мин`
}
