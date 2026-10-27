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

const networkOnly = new NetworkOnly()

const serwist = new Serwist({
  precacheEntries: [...manifest, ...appShellEntries],
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
