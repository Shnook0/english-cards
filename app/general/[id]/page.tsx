'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { GeneralTraining } from '@/types/general'
import { getStats } from '@/lib/general'
import { fetchProgress, fetchTraining, fetchTrainingCards } from '@/lib/offline/repo'

export default function GeneralTrainingPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useOfflineRouter()
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
      const t = await fetchTraining(trainingId)
      if (!t) {
        setError('Тренировка не найдена')
        setLoading(false)
        return
      }
      setTraining(t)

      const [cards, progress] = await Promise.all([
        fetchTrainingCards(t, user.id),
        fetchProgress(trainingId),
      ])
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
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем…</span>
      </div>
    )
  }

  if (error || !training) {
    return (
      <div className="page page-in">
        <div className="card mt-10 flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon tile-icon-danger">
            <Icon name="info" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">{error || 'Тренировка не найдена'}</p>
          <Link href="/general" className="btn btn-secondary mt-5">
            <Icon name="arrowLeft" size={18} />
            К тренировкам
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/general', label: 'Тренировки' }}
        title={training.name}
        description={`Всего слов: ${stats.total}. Сначала идут ошибки, потом слова, которые пора повторить, затем новые.`}
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          { value: stats.fresh, label: 'Новые', accent: false },
          { value: stats.due, label: 'Повторить', accent: false },
          { value: stats.mistakes, label: 'В ошибках', accent: true },
        ].map(item => (
          <div key={item.label} className="card px-3 py-4 text-center">
            <div className={`stat-number${item.accent ? 'text-[#e5786f]' : 'text-[#ececf1]'}`}>
              {item.value}
            </div>
            <div className="mt-2 text-[13px] text-[#8a8a96]">{item.label}</div>
          </div>
        ))}
      </div>

      <Link
        href={`/general/${trainingId}/train`}
        className="btn btn-primary btn-lg btn-block mt-5"
      >
        Начать тренировку
        <Icon name="arrowRight" size={18} />
      </Link>
      <p className="mt-2.5 text-center text-xs text-[#6b6b76]">
        {stats.session > 0
          ? `В этой сессии: ${stats.session} слов`
          : 'Сейчас нет слов для тренировки'}
      </p>

      <h2 className="section-label">Работа над ошибками</h2>
      <Link
        href={`/general/${trainingId}/mistakes`}
        className="card card-link flex items-center gap-4 p-4"
      >
        <span className="tile-icon tile-icon-danger">
          <Icon name="target" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">Ошибки этой тренировки</p>
          <p className="mt-0.5 text-[13px] text-[#8a8a96]">Слов в ошибках: {stats.mistakes}</p>
        </div>
        <Icon name="arrowRight" size={18} className="shrink-0 text-[#6b6b76]" />
      </Link>
    </div>
  )
}