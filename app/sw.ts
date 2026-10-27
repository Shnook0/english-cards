/// <reference lib="webworker" />

import { defaultCache } from '@serwist/turbopack/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { NetworkOnly, Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const networkOnly = new NetworkOnly()

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/'),
      handler: networkOnly,
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()
