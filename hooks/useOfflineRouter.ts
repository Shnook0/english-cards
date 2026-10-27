'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { isOnline } from '@/lib/offline/connectivity'

type AppRouter = ReturnType<typeof useRouter>

export function useOfflineRouter(): AppRouter {
  const router = useRouter()

  return useMemo(() => {
    const push: AppRouter['push'] = (...args) => {
      if (!isOnline()) {
        window.location.assign(args[0])
        return
      }
      router.push(...args)
    }

    const replace: AppRouter['replace'] = (...args) => {
      if (!isOnline()) {
        window.location.replace(args[0])
        return
      }
      router.replace(...args)
    }

    const back: AppRouter['back'] = () => {
      if (!isOnline()) {
        window.location.assign(new URL('/', window.location.origin).href)
        return
      }
      router.back()
    }

    return { ...router, push, replace, back }
  }, [router])
}
