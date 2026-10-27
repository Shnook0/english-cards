import { setMeta } from '@/lib/offline/db'

const CONNECTIVITY_EVENT = 'english-cards:connectivity'

const FAILURE_KEY = 'english-cards:net-failure'
// Сколько считаем, что сети нет, после неудачного запроса. Потом снова пробуем сеть —
// на iOS событие «online» приходит не всегда, поэтому флаг обязан истекать сам.
const FAILURE_TTL_MS = 30000

let failedAt = 0

export function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

// Офлайн-переходы перезагружают страницу целиком, поэтому время сбоя храним и в sessionStorage,
// иначе каждая страница заново ждала бы таймаут запроса.
function setFailedAt(value: number): void {
  failedAt = value
  try {
    if (value) sessionStorage.setItem(FAILURE_KEY, String(value))
    else sessionStorage.removeItem(FAILURE_KEY)
  } catch {}
}

function recentFailure(): boolean {
  if (!failedAt) {
    try {
      failedAt = Number(sessionStorage.getItem(FAILURE_KEY)) || 0
    } catch {}
  }
  return failedAt > 0 && Date.now() - failedAt < FAILURE_TTL_MS
}

export function isOnline(): boolean {
  if (!isBrowser()) return false
  return navigator.onLine && !recentFailure()
}

const SNAPSHOT_KEY = 'english-cards:snapshot-at'

export function markSnapshotFresh(): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, String(Date.now()))
  } catch {}
}

export function clearSnapshotMark(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
  } catch {}
}

export function isSnapshotFresh(maxAgeMs: number): boolean {
  if (!isBrowser()) return false
  try {
    const at = Number(localStorage.getItem(SNAPSHOT_KEY))
    return at > 0 && Date.now() - at < maxAgeMs
  } catch {
    return false
  }
}

// Offline-first: если полная копия данных уже есть на устройстве, страницы читают только её,
// а свежие данные подтягивает фоновая синхронизация. Сеть при чтении нужна лишь до первой
// успешной синхронизации — иначе в авиарежиме на iOS («онлайн», но запросы висят) страницы ждут.
export function isReadOnline(): boolean {
  return isOnline() && !isSnapshotFresh(Number.POSITIVE_INFINITY)
}

export function noteNetworkFailure(): void {
  if (!isBrowser()) return
  const wasOnline = !recentFailure()
  setFailedAt(Date.now())
  if (wasOnline) window.dispatchEvent(new Event(CONNECTIVITY_EVENT))
}

export function noteNetworkSuccess(): void {
  if (!isBrowser()) return
  const wasOffline = recentFailure()
  setFailedAt(0)
  if (wasOffline) window.dispatchEvent(new Event(CONNECTIVITY_EVENT))
}

export function resetForcedOffline(): void {
  noteNetworkSuccess()
}

export function subscribeConnectivity(listener: () => void): () => void {
  if (!isBrowser()) return () => {}
  const onOnline = () => {
    setFailedAt(0)
    listener()
  }
  const onOffline = () => listener()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener(CONNECTIVITY_EVENT, listener)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener(CONNECTIVITY_EVENT, listener)
  }
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof TypeError) return true
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''
  return /failed to fetch|fetch failed|network ?error|load failed|networkrequestfailed|timeout|offline|aborted/i.test(
    message
  )
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export async function setLastSyncAt(value: string | null): Promise<void> {
  await setMeta('last_sync_at', value)
}
