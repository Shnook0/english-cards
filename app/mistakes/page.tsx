'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Card } from '@/types/database'
import {
  fetchCards,
  fetchFolders,
  resetWrongCount,
  setFavorite,
} from '@/lib/offline/repo'

type CardWithFolder = Card & { folders?: { name: string } | null }

export default function MistakesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()
  const [cards, setCards] = useState<CardWithFolder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [list, folders] = await Promise.all([
      fetchCards({ userId: user.id, mistakes: true, order: 'wrong_desc' }),
      fetchFolders(user.id),
    ])
    const names = new Map(folders.map(folder => [folder.id, folder.name]))
    setCards(
      list.map(card => ({
        ...card,
        folders: { name: names.get(card.folder_id) ?? 'Без папки' },
      }))
    )
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const toggleFav = async (cardId: string, current: boolean) => {
    const ok = await setFavorite(cardId, !current)
    if (!ok) return
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, is_favorite: !current } : c))
  }

  const removeFromMistakes = async (cardId: string) => {
    if (!confirm('Убрать слово из «Частых ошибок»? Счётчик ошибок обнулится.')) return
    const ok = await resetWrongCount(cardId)
    if (!ok) return
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем ошибки…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Частые ошибки"
        description={`Слова, в которых вы ошиблись 2 раза и больше — по всем папкам. Сейчас: ${cards.length}.`}
      />

      {cards.length > 0 && (
        <Link href="/mistakes/train" className="btn btn-primary btn-lg btn-block">
          Повторить ошибки
          <Icon name="arrowRight" size={18} />
        </Link>
      )}

      {cards.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon tile-icon-success">
            <Icon name="check" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">
            Отличная работа! У вас нет слов с частыми ошибками.
          </p>
          <Link href="/general" className="btn btn-secondary mt-5">
            К тренировкам
          </Link>
        </div>
      ) : (
        <>
          <h2 className="section-label">Слова</h2>
          <div className="flex flex-col gap-3">
            {cards.map(card => (
              <div key={card.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-lg font-semibold">{card.word}</span>
                      {card.transcription && (
                        <span className="font-mono text-[13px] text-[#8a8a96]">
                          {card.transcription}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[15px] text-[#b0b0bb]">{card.translation}</p>
                  </div>
                  <button
                    onClick={() => toggleFav(card.id, card.is_favorite)}
                    className="icon-btn shrink-0"
                    style={card.is_favorite ? { color: 'var(--warning)' } : undefined}
                    title="Избранное"
                    aria-label={card.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                    aria-pressed={card.is_favorite}
                  >
                    <Icon name="star" size={18} />
                  </button>
                </div>

                {card.sentences && card.sentences.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-l-2 border-[#8ea2ff]/30 pl-3 text-[13px] leading-5 text-[#8a8a96]">
                    {card.sentences.map((s, i) => (
                      <p key={i}>{s}</p>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 border-t border-[#24242b] pt-3">
                  <span className="chip chip-danger shrink-0">Ошибок: {card.wrong_count}</span>
                  <span className="chip min-w-0 overflow-hidden">
                    <Icon name="folder" size={14} className="shrink-0" />
                    <span className="truncate">{card.folders?.name || '—'}</span>
                  </span>
                  <button
                    onClick={() => removeFromMistakes(card.id)}
                    className="btn btn-ghost btn-sm ml-auto shrink-0"
                    title="Убрать из частых ошибок"
                  >
                    Убрать
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}