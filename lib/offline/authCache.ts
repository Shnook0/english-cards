import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getMeta, setMeta } from '@/lib/offline/db'
import { isOnline } from '@/lib/offline/connectivity'
import { CachedUser } from '@/types/offline'

const AUTH_CACHE_KEY = 'cached_user'

export async function cacheUser(user: User | null): Promise<void> {
  if (!user) return
  const cached: CachedUser = { id: user.id, email: user.email ?? null }
  await setMeta(AUTH_CACHE_KEY, cached)
}

export async function getCachedUser(): Promise<CachedUser | null> {
  return getMeta<CachedUser>(AUTH_CACHE_KEY)
}

export async function clearCachedUser(): Promise<void> {
  await setMeta(AUTH_CACHE_KEY, null)
}

export async function resolveUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (user) {
      await cacheUser(user)
      return user.id
    }
  } catch {
    // Offline: fall through to the cached user below.
  }

  if (!isOnline()) {
    const cached = await getCachedUser()
    return cached?.id ?? null
  }

  return null
}
