import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getMeta, setMeta } from '@/lib/offline/db'
import { clearSnapshotMark, isOnline } from '@/lib/offline/connectivity'
import { CachedUser } from '@/types/offline'

const AUTH_CACHE_KEY = 'cached_user'

export async function cacheUser(user: User | null): Promise<void> {
  if (!user) return
  const previous = await getMeta<CachedUser>(AUTH_CACHE_KEY)
  // Локальная копия принадлежит другому аккаунту — читать её нельзя до новой синхронизации.
  if (previous && previous.id !== user.id) clearSnapshotMark()
  const cached: CachedUser = { id: user.id, email: user.email ?? null }
  await setMeta(AUTH_CACHE_KEY, cached)
}

export async function getCachedUser(): Promise<CachedUser | null> {
  return getMeta<CachedUser>(AUTH_CACHE_KEY)
}

export async function clearCachedUser(): Promise<void> {
  await setMeta(AUTH_CACHE_KEY, null)
}

const SESSION_TIMEOUT_MS = 3000

// Offline, supabase retries the token refresh for a long time; never wait on it.
export async function getSessionUser(): Promise<User | null> {
  if (!isOnline()) return null
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), SESSION_TIMEOUT_MS)),
    ])
    return result?.data.session?.user ?? null
  } catch {
    return null
  }
}

export async function resolveUserId(): Promise<string | null> {
  const user = await getSessionUser()
  if (user) {
    await cacheUser(user)
    return user.id
  }

  if (!isOnline()) {
    const cached = await getCachedUser()
    return cached?.id ?? null
  }

  return null
}
