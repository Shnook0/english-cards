import {
  fetchBestScore as fetchBestScoreLocal,
  saveBestScore as saveBestScoreLocal,
} from '@/lib/offline/data'

export async function fetchBestScore(scope: string): Promise<number> {
  return (await fetchBestScoreLocal(scope)) ?? 0
}

export async function saveBestScore(scope: string, score: number): Promise<boolean> {
  try {
    return await saveBestScoreLocal(scope, score)
  } catch {
    return false
  }
}
