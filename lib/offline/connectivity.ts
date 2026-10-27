import { setMeta } from '@/lib/offline/db'

const CONNECTIVITY_EVENT = 'english-cards:connectivity'

let forcedOffline = false

export function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

export function isOnline(): boolean {
  if (!isBrowser()) return false
  return navigator.onLine && !forcedOffline
}

export function noteNetworkFailure(): void {
  if (!isBrowser()) return
  if (!forcedOffline) {
    forcedOffline = true
    window.dispatchEvent(new Event(CONNECTIVITY_EVENT))
  }
}

export function noteNetworkSuccess(): void {
  if (!isBrowser()) return
  if (forcedOffline) {
    forcedOffline = false
    window.dispatchEvent(new Event(CONNECTIVITY_EVENT))
  }
}

export function resetForcedOffline(): void {
  if (forcedOffline) {
    forcedOffline = false
    if (isBrowser()) window.dispatchEvent(new Event(CONNECTIVITY_EVENT))
  }
}

export function subscribeConnectivity(listener: () => void): () => void {
  if (!isBrowser()) return () => {}
  const onOnline = () => {
    forcedOffline = false
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
