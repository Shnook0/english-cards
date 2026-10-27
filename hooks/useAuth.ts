'use client'

import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { cacheUser, clearCachedUser, getCachedUser, getSessionUser } from '@/lib/offline/authCache'

function cachedAsUser(cached: { id: string; email: string | null } | null): User | null {
  if (!cached) return null
  return { id: cached.id, email: cached.email } as User
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const init = async () => {
      // Сначала берём пользователя с устройства — не ждём сеть. Сессию проверяем в фоне.
      const cached = await getCachedUser().catch(() => null)
      if (!mounted) return

      if (cached) {
        setUser(cachedAsUser(cached))
        setLoading(false)
        const fresh = await getSessionUser()
        if (!mounted || !fresh) return
        await cacheUser(fresh)
        if (fresh.id !== cached.id) setUser(fresh)
        return
      }

      const sessionUser = await getSessionUser()

      if (!mounted) return

      if (sessionUser) {
        await cacheUser(sessionUser)
        setUser(sessionUser)
      } else {
        const cached = await getCachedUser()
        setUser(cachedAsUser(cached))
      }
      setLoading(false)
    }

    void init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION без сессии не значит «не вошёл»: пользователя с устройства
      // подхватывает init(), поэтому здесь loading снимаем только по точным событиям.
      if (event === 'SIGNED_OUT') {
        void clearCachedUser()
        setUser(null)
        setLoading(false)
      } else if (session?.user) {
        void cacheUser(session.user)
        setUser(session.user)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}
