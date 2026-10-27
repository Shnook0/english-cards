import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase в .env.local')
}

const READ_TIMEOUT_MS = 3000
const WRITE_TIMEOUT_MS = 20000

// iOS в авиарежиме часто оставляет navigator.onLine = true, и запросы к Supabase
// подвисают. Ограничиваем их по времени, чтобы приложение переходило на локальные данные.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('network timeout')),
    method === 'GET' || method === 'HEAD' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS
  )

  const outer = init?.signal
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason)
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
})
