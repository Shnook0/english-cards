import {
  fetchBestTime as fetchBestTimeLocal,
  saveBestTime as saveBestTimeLocal,
} from '@/lib/offline/data'

export function formatTime(s: number): string {
  return s.toFixed(1).replace('.', ',')
}

export async function fetchBestTime(scope: string): Promise<number | null> {
  return fetchBestTimeLocal(scope)
}

export async function saveBestTime(
  scope: string,
  time: number
): Promise<'saved' | 'not_better' | 'error'> {
  try {
    return await saveBestTimeLocal(scope, time)
  } catch {
    return 'error'
  }
}
