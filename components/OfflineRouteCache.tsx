'use client'

import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { isOnline, subscribeConnectivity } from '@/lib/offline/connectivity'
import { warmRouteCache } from '@/lib/offline/routeCache'

export default function OfflineRouteCache() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const warm = () => {
      if (cancelled || !isOnline()) return
      void warmRouteCache().catch(() => {})
    }

    const timers = [setTimeout(warm, 3000), setTimeout(warm, 12000)]
    const unsubscribe = subscribeConnectivity(() => {
      if (isOnline()) warm()
    })

    const hadController =
      'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller)

    const onControllerChange = () => {
      warm()
      if (hadController && isOnline()) window.location.reload()
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    }

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      unsubscribe()
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      }
    }
  }, [user])

  return null
}
