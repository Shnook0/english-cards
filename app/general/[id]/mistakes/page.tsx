'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { fetchProgress, fetchTrainingCards, isMistakeActive, wordKey } from '@/lib/general'

type MistakeItem = { card: Card; progress: GeneralProgress }

export default function GeneralMistakesPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
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
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-10 flex items-center justify-between">
          <Link
            href={`/general/${trainingId}`}
            className="link-muted text-xs uppercase tracking-[0.18em]"
          >
            ← {training.name}
          </Link>
          <span className="eyebrow">Разбор ошибок</span>
        </div>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-[#24221e] pb-8">
          <div>
            <p className="eyebrow mb-3">Общая практика</p>
            <h1 className="display text-5xl md:text-6xl">Общие ошибки</h1>
            <p className="mt-4 text-sm text-[#948e82]">Слов в ошибках: {items.length}</p>
          </div>
          {items.length > 0 && (
            <Link
              href={`/general/${trainingId}/mistakes/train`}
              className="btn btn-primary"
            >
              Повторить
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <div className="panel p-14 text-center">
            <p className="display mb-3 text-3xl">Чисто</p>
            <p className="text-sm text-[#948e82]">Сейчас в ошибках нет слов.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map(({ card, progress }) => (
              <div key={card.id} className="panel panel-hover flex flex-col justify-between p-6">
                <div>
                  <span className="font-[family-name:var(--font-display)] text-2xl">
                    {card.word}
                  </span>
                  {card.transcription && (
                    <p className="mt-1 text-sm text-[#948e82]">{card.transcription}</p>
                  )}
                  <p className="mb-4 mt-3 text-base text-[#f2eee5]">{card.translation}</p>
                </div>
                <div className="border-t border-[#24221e] pt-4 text-xs leading-5 text-[#948e82]">
                  В ошибках до: {formatUntil(progress.mistake_until)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}