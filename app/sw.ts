/// <reference lib="webworker" />

import { defaultCache } from '@serwist/turbopack/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const manifest = self.__SW_MANIFEST ?? []
const buildId = manifest
  .map(entry => (typeof entry === 'string' ? entry : entry.url))
  .map(url => /\/_next\/static\/([^/]+)\/_buildManifest\.js/.exec(url)?.[1])
  .find((value): value is string => Boolean(value))

const appShellEntries: PrecacheEntry[] = [
  '/',
  '/login',
  '/folders',
  '/favorites',
  '/favorites/train',
  '/mistakes',
  '/mistakes/train',
  '/levels',
  '/general',
  '/settings',
  '/reset-password',
].map(url => ({ url, revision: buildId ?? 'app-shell' }))

const RSC_TIMEOUT_MS = 2000
const OFFLINE_MEMORY_MS = 30000
const appPagesCache = `app-pages-${buildId ?? 'app-shell'}`
const networkOnly = new NetworkOnly()

// Помним, что сеть недавно не ответила: следующие переходы не ждут таймаут,
// а сразу уходят на полную загрузку страницы из кэша. Сеть проверяем в фоне.
let networkFailedAt = 0
const networkRecentlyFailed = () => Date.now() - networkFailedAt < OFFLINE_MEMORY_MS
const networkStatePlugin = {
  fetchDidFail: async () => {
    networkFailedAt = Date.now()
  },
  fetchDidSucceed: async ({ response }: { response: Response }) => {
    networkFailedAt = 0
    return response
  },
}

async function fetchRsc(request: Request): Promise<Response> {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(RSC_TIMEOUT_MS) })
    networkFailedAt = 0
    return response
  } catch {
    networkFailedAt = Date.now()
    return Response.error()
  }
}

const serwist = new Serwist({
  precacheEntries: [...manifest, ...appShellEntries],
  skipWaiting: true,
  clientsClaim: true,
  // Предзагрузка навигации заставляла ждать сеть даже для страниц из кэша:
  // в авиарежиме на iOS запуск висел десятки секунд.
  navigationPreload: false,
  runtimeCaching: [
    {
      // Клиентские переходы Next запрашивают RSC. Встроенное правило ждёт сеть 10 с,
      // а iOS в авиарежиме не сразу отдаёт ошибку. После сбоя Next сам делает полную
      // загрузку страницы, которую отдаёт кэш.
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        !url.pathname.startsWith('/api/') &&
        request.mode !== 'navigate' &&
        (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')),
      handler: async ({ request }: { request: Request }) => {
        if (networkRecentlyFailed()) {
          void fetchRsc(request.clone())
          return Response.error()
        }
        return fetchRsc(request)
      },
    },
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        !url.pathname.startsWith('/api/') &&
        (request.mode === 'navigate' || request.destination === 'document'),
      handler: new StaleWhileRevalidate({
        cacheName: appPagesCache,
        matchOptions: { ignoreVary: true },
        plugins: [
          networkStatePlugin,
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/'),
      handler: networkOnly,
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline.html',
        matcher: ({ request }) =>
          request.mode === 'navigate' || request.destination === 'document',
      },
    ],
  },
})

serwist.addEventListeners()

const MAX_WARM_ROUTES = 60
let warming = false

async function warmRoutes(urls: string[]): Promise<void> {
  if (!Array.isArray(urls) || warming) return
  warming = true

  try {
    const cache = await caches.open(appPagesCache)
    const origin = self.location.origin
    let added = 0

    for (const value of urls) {
      if (added >= MAX_WARM_ROUTES) break
      if (typeof value !== 'string' || !value.startsWith('/')) continue

      let url: URL
      try {
        url = new URL(value, origin)
      } catch {
        continue
      }
      if (url.origin !== origin) continue

      const cached = await cache.match(url.href, { ignoreVary: true })
      if (cached) continue

      try {
        const response = await fetch(url.href, {
          credentials: 'same-origin',
          headers: { Accept: 'text/html' },
        })
        if (
          response.ok &&
          response.headers.get('content-type')?.includes('text/html')
        ) {
          await cache.put(url.href, response)
          added++
        }
      } catch {}
    }
  } finally {
    warming = false
  }
}

self.addEventListener('message', event => {
  const data = event.data as { type?: unknown; urls?: unknown } | null
  if (!data || data.type !== 'warm-routes' || !Array.isArray(data.urls)) return
  event.waitUntil(warmRoutes(data.urls))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('app-pages-') && key !== appPagesCache)
          .map(key => caches.delete(key))
      )
    )
  )
})
