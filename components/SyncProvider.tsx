'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { getSyncState, syncNow } from '@/lib/offline/sync'
import { subscribeConnectivity } from '@/lib/offline/connectivity'
import { subscribeOutbox } from '@/lib/offline/outbox'
import { SyncState } from '@/types/offline'

const IDLE: SyncState = {
  status: 'idle',
  online: true,
  pending: 0,
  conflicts: 0,
  lastSyncAt: null,
  error: null,
}

export default function SyncProvider() {
  const { user } = useAuth()
  const [state, setState] = useState<SyncState>(IDLE)
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const refreshState = useCallback(async () => {
    if (!user) {
      setState(IDLE)
      return
    }
    try {
      const next = await getSyncState()
      if (mountedRef.current) setState(next)
    } catch {
      // IndexedDB может быть недоступен в приватном режиме
    }
  }, [user])

  const runSync = useCallback(async () => {
    if (!user || syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await syncNow(user.id)
      if (mountedRef.current) {
        setState(prev => ({
          ...prev,
          pending: result.pending,
          conflicts: result.conflicts,
          status: !prev.online
            ? 'offline'
            : result.ok
            ? 'idle'
            : result.failed > 0
            ? 'error'
            : prev.status,
          error: result.error ?? (result.failed > 0 ? `Не отправлено: ${result.failed}` : null),
        }))
      }
    } finally {
      syncingRef.current = false
      if (mountedRef.current) setSyncing(false)
      await refreshState()
    }
  }, [user, refreshState])

  const schedule = useCallback(
    (delay = 600) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void runSync()
      }, delay)
    },
    [runSync]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  useEffect(() => {
    if (!user) return

    void runSync()

    const unsubConnectivity = subscribeConnectivity(() => {
      void refreshState()
      if (navigator.onLine) schedule(300)
    })
    const unsubOutbox = subscribeOutbox(() => {
      void refreshState()
      schedule(1800)
    })

    const onVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) schedule(500)
    }
    const onOnline = () => schedule(300)

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const interval = setInterval(() => {
      if (navigator.onLine) void runSync()
    }, 120000)

    return () => {
      unsubConnectivity()
      unsubOutbox()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearInterval(interval)
    }
  }, [user, runSync, refreshState, schedule])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return
    void navigator.storage.persist().catch(() => {})
  }, [])

  if (!user) return null

  const hasProblems = !state.online || state.pending > 0 || state.conflicts > 0 || !!state.error
  if (!hasProblems && !syncing) return null

  let text = 'Синхронизация…'
  if (!state.online) {
    text =
      state.pending > 0
        ? `Офлайн · ${state.pending} изменений сохранено на устройстве`
        : 'Офлайн · данные сохранены на устройстве'
  } else if (state.conflicts > 0) {
    text = `Конфликты: ${state.conflicts} · решить в настройках`
  } else if (state.error) {
    text = state.error
  } else if (state.pending > 0) {
    text = `Ждут отправки: ${state.pending}`
  }

  const accent = !state.online
    ? 'border-[#44444e] text-[#b0b0bb]'
    : state.conflicts > 0 || state.error
    ? 'border-[#e5786f]/60 text-[#f0a39b]'
    : 'border-[#8ea2ff]/50 text-[#8ea2ff]'

  return (
    <Link
      href="/settings"
      className={`sync-pill fixed right-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-full border bg-[#15151a]/95 px-3.5 py-2 text-xs shadow-xl backdrop-blur transition hover:border-[#8ea2ff] ${accent}`}
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
      {text}
    </Link>
  )
}
