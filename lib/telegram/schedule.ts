import type { TelegramSettings } from './store'

export const DONT_KNOW_FIRST_MINUTES = 15

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

export const DONT_KNOW_STAGE_LABELS = [
  'через 15 минут',
  'через 2 часа',
  'через 5 часов',
  'через 1 день',
  'через 2 дня',
  'через 4 дня',
  'через 7 дней · первый раз',
  'через 7 дней · второй раз',
  'через 15 дней',
  'через 30 дней',
] as const

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
  const first = windowPoint(settings, 0.25)
  const second = windowPoint(settings, 0.75)

  for (const [days, stage] of [
    [1, 3],
    [2, 4],
    [4, 5],
    [15, 8],
    [30, 9],
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

  for (const [stage, time] of [
    [6, first],
    [7, second],
  ] as const) {
    result.push({
      stage,
      dueAt: localTimeToUtc(
        addDaysToDateKey(today, 7),
        time,
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

export function parseInterval(input: string): number | null {
  const match = input
    .trim()
    .match(new RegExp(`^(\\d+)\\s*(${INTERVAL_UNITS})?$`, 'i'))
  if (!match) return null

  const value = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  const hours = ['h', 'hour', 'hours', 'ч', 'час', 'часа', 'часов']
  const minutes = hours.includes(unit) ? value * 60 : value

  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) return null
  return minutes
}

export function formatInterval(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  return `${minutes} мин`
}
