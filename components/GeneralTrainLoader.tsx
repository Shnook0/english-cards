'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { buildQueue, fetchProgress, fetchTrainingCards } from '@/lib/general'
import GeneralTrainSession from '@/components/GeneralTrainSession'

type Props = {
  trainingId: string
  onlyMistakes: boolean
  exitHref: string
}

export default function GeneralTrainLoader({ trainingId, onlyMistakes, exitHref }: Props) {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [queue, setQueue] = useState<Card[]>([])
  const [progress, setProgress] = useState<Record<string, GeneralProgress>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (user && trainingId) load()
  }, [user, trainingId])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: t, error: tErr } = await supabase
        .from('general_trainings')
        .select('*')
        .eq('id', trainingId)
        .single()
      if (tErr || !t) {
        setError('Тренировка не найдена')
        setLoading(false)
        return
      }

      const cards = await fetchTrainingCards(t as GeneralTraining, user!.id)
      const prog = await fetchProgress(trainingId)
      setProgress(prog)
      setQueue(buildQueue(cards, prog, onlyMistakes))
    } catch {
      setError('Не удалось подготовить тренировку')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">
        Загрузка тренировки...
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#bb7464]">{error}</p>
        <Link href={exitHref} className="text-sm text-[#c9a96e] hover:underline">← Назад</Link>
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