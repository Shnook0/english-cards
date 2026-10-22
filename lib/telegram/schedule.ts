import type { TelegramSettings } from './store'

export function normalizeTime(value: string): string {
  return value.slice(0, 5)
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

export function parseInterval(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*(m|min|мин|h|hour|час|ч)?$/i)
  if (!match) return null

  const value = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  const minutes = unit === 'h' || unit === 'hour' || unit === 'час' || unit === 'ч'
    ? value * 60
    : value

  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) return null
  return minutes
}

export function formatInterval(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  return `${minutes} мин`
}
