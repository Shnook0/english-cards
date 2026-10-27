'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Card } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { isMistakeActive, wordKey } from '@/lib/general'
import { fetchProgress, fetchTraining, fetchTrainingCards } from '@/lib/offline/repo'

type MistakeItem = { card: Card; progress: GeneralProgress }

export default function GeneralMistakesPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useOfflineRouter()
  const trainingId = params.id as string

  const [training, setTraining] = useState<GeneralTraining | null>(null)
  const [items, setItems] = useState<MistakeItem[]>([])
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
      const now = Date.now()

      const list: MistakeItem[] = []
      for (const c of cards) {
        const p = progress[wordKey(c)]
        if (p && isMistakeActive(p, now)) list.push({ card: c, progress: p })
      }
      list.sort(
        (a, b) =>
          new Date(b.progress.mistake_until as string).getTime() -
          new Date(a.progress.mistake_until as string).getTime()
      )
      setItems(list)
    } catch {
      setError('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [user, trainingId])

  useEffect(() => {
    if (user && trainingId) void load()
  }, [user, trainingId, load])

  const formatUntil = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })
      : ''

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем ошибки…</span>
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
        back={{ href: `/general/${trainingId}`, label: training.name }}
        title="Ошибки тренировки"
        description={`Слова, на которые вы ответили «Не знаю». Они остаются здесь 2 дня или пока вы не ответите «Знаю» 2 раза подряд. Сейчас: ${items.length}.`}
      />

      {items.length > 0 && (
        <Link
          href={`/general/${trainingId}/mistakes/train`}
          className="btn btn-primary btn-lg btn-block"
        >
          Повторить ошибки
          <Icon name="arrowRight" size={18} />
        </Link>
      )}

      {items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon tile-icon-success">
            <Icon name="check" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">Сейчас в ошибках нет слов.</p>
          <Link href={`/general/${trainingId}`} className="btn btn-secondary mt-5">
            К тренировке
          </Link>
        </div>
      ) : (
        <>
          <h2 className="section-label">Слова в ошибках</h2>
          <div className="flex flex-col gap-3">
            {items.map(({ card, progress }) => (
              <div key={card.id} className="card p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-lg font-semibold">{card.word}</span>
                  {card.transcription && (
                    <span className="font-mono text-[13px] text-[#8a8a96]">{card.transcription}</span>
                  )}
                </div>
                <p className="mt-1 text-[15px] text-[#b0b0bb]">{card.translation}</p>
                <p className="mt-3 text-xs text-[#6b6b76]">
                  В ошибках до {formatUntil(progress.mistake_until)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}