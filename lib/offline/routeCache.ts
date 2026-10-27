import { isOnline } from '@/lib/offline/connectivity'
import { getDb } from '@/lib/offline/db'

const PLAY_MODES = ['learn', 'match', 'blocks', 'dictation']

async function collectRoutes(): Promise<string[]> {
  const db = getDb()
  const [folders, trainings] = await Promise.all([
    db.folders.toArray(),
    db.general_trainings.toArray(),
  ])

  const urls = new Set<string>()

  for (const folder of folders) {
    urls.add(`/folder/${folder.id}`)
    urls.add(`/folder/${folder.id}/train`)
    for (const mode of PLAY_MODES) {
      urls.add(`/folder/${folder.id}/play/${mode}`)
    }
  }

  for (const training of trainings) {
    urls.add(`/general/${training.id}`)
    urls.add(`/general/${training.id}/train`)
    urls.add(`/general/${training.id}/mistakes`)
    urls.add(`/general/${training.id}/mistakes/train`)
  }

  return [...urls]
}

export async function warmRouteCache(): Promise<void> {
  if (!isOnline() || typeof navigator === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  const registration = await navigator.serviceWorker.ready
  const worker = registration.active ?? navigator.serviceWorker.controller
  if (!worker) return

  worker.postMessage({
    type: 'warm-routes',
    urls: await collectRoutes(),
  })
}
