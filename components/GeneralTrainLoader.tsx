'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card } from '@/types/database'
import { GeneralProgress } from '@/types/general'
import { buildQueue } from '@/lib/general'
import { fetchProgress, fetchTraining, fetchTrainingCards } from '@/lib/offline/repo'
import GeneralTrainSession from '@/components/GeneralTrainSession'

type Props = {
  trainingId: string
  onlyMistakes: boolean
  exitHref: string
}

export default function GeneralTrainLoader({ trainingId, onlyMistakes, exitHref }: Props) {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

  const [queue, setQueue] = useState<Card[]>([])
  const [progress, setProgress] = useState<Record<string, GeneralProgress>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)
    try {
      const t = await fetchTraining(trainingId)
      if (!t) {
        setError('Тренировка не найдена')
        setLoading(false)
        return
      }

      const [cards, prog] = await Promise.all([
        fetchTrainingCards(t, user.id),
        fetchProgress(trainingId),
      ])
      setProgress(prog)
      setQueue(buildQueue(cards, prog, onlyMistakes))
    } catch {
      setError('Не удалось подготовить тренировку')
    } finally {
      setLoading(false)
    }
  }, [user, trainingId, onlyMistakes])

  useEffect(() => {
    if (user && trainingId) void load()
  }, [user, trainingId, load])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center">
        Загрузка тренировки...
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#e5786f]">{error}</p>
        <Link href={exitHref} className="text-sm text-[#8ea2ff] hover:underline">← Назад</Link>
      </div>
    )
  }

  return (
    <GeneralTrainSession
      trainingId={trainingId}
      userId={user!.id}
      initialCards={queue}
      initialProgress={progress}
      onExit={() => router.push(exitHref)}
    />
  )
}