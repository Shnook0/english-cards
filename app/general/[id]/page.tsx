'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { GeneralTraining } from '@/types/general'
import { fetchProgress, fetchTrainingCards, getStats } from '@/lib/general'

export default function GeneralTrainingPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
  const trainingId = params.id as string

  const [training, setTraining] = useState<GeneralTraining | null>(null)
  const [stats, setStats] = useState({ total: 0, fresh: 0, due: 0, mistakes: 0, session: 0 })
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
      setTraining(t as GeneralTraining)

      const cards = await fetchTrainingCards(t as GeneralTraining, user!.id)
      const progress = await fetchProgress(trainingId)
      setStats(getStats(cards, progress))
    } catch {
      setError('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  if (error || !training) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#a04a4a]">{error || 'Тренировка не найдена'}</p>
        <Link href="/general" className="text-sm text-[#6c7cff] hover:underline">← Назад</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/general" className="text-sm text-[#8b90a0] hover:text-[#6c7cff] transition">
            ← К общим тренировкам
          </Link>
        </div>

        <div className="mb-8 pb-6 border-b border-gray-800">
          <h1 className="text-3xl font-bold mb-1">{training.name}</h1>
          <p className="text-sm text-[#8b90a0]">Всего слов: {stats.total}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-8 text-center">
          <div className="rounded-xl border border-gray-800 bg-[#1a1d23] p-4">
            <div className="text-2xl font-bold">{stats.fresh}</div>
            <div className="text-xs text-[#8b90a0] mt-1">Новых</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[#1a1d23] p-4">
            <div className="text-2xl font-bold">{stats.due}</div>
            <div className="text-xs text-[#8b90a0] mt-1">К повторению</div>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[#1a1d23] p-4">
            <div className="text-2xl font-bold text-[#a04a4a]">{stats.mistakes}</div>
            <div className="text-xs text-[#8b90a0] mt-1">В ошибках</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href={`/general/${trainingId}/train`}
            className="rounded-2xl border border-[#6c7cff]/40 bg-[#6c7cff]/10 p-6 hover:border-[#6c7cff] transition"
          >
            <h3 className="text-lg font-bold mb-1">Начать тренировку</h3>
            <p className="text-sm text-[#8b90a0]">
              {stats.session > 0
                ? `В этой сессии: ${stats.session} слов`
                : 'Сейчас нет слов для тренировки'}
            </p>
          </Link>

          <Link
            href={`/general/${trainingId}/mistakes`}
            className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 hover:border-[#6c7cff] transition"
          >
            <h3 className="text-lg font-bold mb-1">Общие ошибки</h3>
            <p className="text-sm text-[#8b90a0]">Слов в ошибках: {stats.mistakes}</p>
          </Link>
        </div>
      </div>
    </div>
  )
}