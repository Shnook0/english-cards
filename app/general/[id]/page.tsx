'use client'

import { useCallback, useEffect, useState } from 'react'
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

  const load = useCallback(async () => {
    if (!user) return

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

      const cards = await fetchTrainingCards(t as GeneralTraining, user.id)
      const progress = await fetchProgress(trainingId)
      setStats(getStats(cards, progress))
    } catch {
      setError('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [user, trainingId])

  useEffect(() => {
    if (user && trainingId) void load()
  }, [user, trainingId, load])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  if (error || !training) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#bb7464]">{error || 'Тренировка не найдена'}</p>
        <Link href="/general" className="text-sm text-[#c9a96e] hover:underline">← Назад</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-5 py-8 md:px-10 md:py-14">
      <div className="page-in mx-auto max-w-4xl">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/general" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← К общим тренировкам
          </Link>
          <span className="eyebrow">Набор</span>
        </div>

        <div className="mb-10 border-b border-[#24221e] pb-8">
          <p className="eyebrow mb-3">Общая практика</p>
          <h1 className="display text-5xl md:text-6xl">{training.name}</h1>
          <p className="mt-4 text-sm text-[#948e82]">Всего слов: {stats.total}</p>
        </div>

        <div className="mb-8 grid grid-cols-3 gap-3">
          {[
            { value: stats.fresh, label: 'Новых', accent: false },
            { value: stats.due, label: 'К повторению', accent: false },
            { value: stats.mistakes, label: 'В ошибках', accent: true },
          ].map(item => (
            <div key={item.label} className="panel p-5 text-center">
              <div className={`stat-number ${item.accent ? 'text-[#bb7464]' : 'text-[#f2eee5]'}`}>
                {item.value}
              </div>
              <div className="eyebrow mt-3">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Link
            href={`/general/${trainingId}/train`}
            className="panel panel-hover border-[#c9a96e]/30 bg-[#c9a96e]/[0.06] p-7"
          >
            <p className="eyebrow mb-3 text-[#c9a96e]">Сессия</p>
            <h3 className="text-2xl">Начать тренировку</h3>
            <p className="mt-3 text-sm leading-6 text-[#948e82]">
              {stats.session > 0
                ? `В этой сессии: ${stats.session} слов`
                : 'Сейчас нет слов для тренировки'}
            </p>
          </Link>

          <Link
            href={`/general/${trainingId}/mistakes`}
            className="panel panel-hover p-7"
          >
            <p className="eyebrow mb-3">Работа над ошибками</p>
            <h3 className="text-2xl">Общие ошибки</h3>
            <p className="mt-3 text-sm leading-6 text-[#948e82]">
              Слов в ошибках: {stats.mistakes}
            </p>
          </Link>
        </div>
      </div>
    </div>
  )
}