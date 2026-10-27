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
import Icon from '@/components/ui/Icon'

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
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Готовим тренировку…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
        <p className="text-base text-[#e5786f]">{error}</p>
        <Link href={exitHref} className="btn btn-secondary mt-5">
          <Icon name="arrowLeft" size={16} />
          Назад
        </Link>
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