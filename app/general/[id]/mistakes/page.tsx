'use client'

import { useEffect, useState } from 'react'
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
  }

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
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/general/${trainingId}`}
            className="text-sm text-[#8b90a0] hover:text-[#6c7cff] transition"
          >
            ← {training.name}
          </Link>
        </div>

        <div className="flex items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold mb-1">Общие ошибки</h1>
            <p className="text-sm text-[#8b90a0]">Слов в ошибках: {items.length}</p>
          </div>
          {items.length > 0 && (
            <Link
              href={`/general/${trainingId}/mistakes/train`}
              className="rounded-lg bg-[#6c7cff] px-5 py-2.5 font-medium text-white hover:bg-[#5865e0] transition"
            >
              Повторить
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-12 text-center text-[#8b90a0]">
            Сейчас в ошибках нет слов.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(({ card, progress }) => (
              <div
                key={card.id}
                className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 flex flex-col justify-between"
              >
                <div>
                  <span className="text-lg font-bold">{card.word}</span>
                  {card.transcription && (
                    <p className="text-sm text-[#8b90a0] mt-1">{card.transcription}</p>
                  )}
                  <p className="text-md font-medium mt-2 mb-3">{card.translation}</p>
                </div>
                <div className="text-xs text-[#8b90a0] pt-3 border-t border-gray-800/50">
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