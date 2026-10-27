'use client'

import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { cacheUser, clearCachedUser, getCachedUser } from '@/lib/offline/authCache'

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
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (session?.user) {
        await cacheUser(session.user)
        setUser(session.user)
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
      if (event === 'SIGNED_OUT') {
        void clearCachedUser()
        setUser(null)
      } else if (session?.user) {
        void cacheUser(session.user)
        setUser(session.user)
      }
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}
