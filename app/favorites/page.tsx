'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Card } from '@/types/database'
import { fetchCards, setFavorite } from '@/lib/offline/repo'

export default function FavoritesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [user, authLoading, router])

  const fetchFavoriteCards = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)

    try {
      setCards(await fetchCards({ userId: user.id, favorite: true, order: 'created_desc' }))
    } catch {
      setError('Ошибка при загрузке избранных карточек')
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (user) {
      void fetchFavoriteCards()
    }
  }, [user, fetchFavoriteCards])

  const handleRemoveFavorite = async (cardId: string) => {
    const ok = await setFavorite(cardId, false)
    if (ok) {
      setCards(cards.filter(c => c.id !== cardId))
    } else {
      setError('Не удалось изменить избранное')
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем избранное…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Избранное"
        description={`Слова, которые вы отметили звёздочкой, — из всех папок в одном месте. Сейчас: ${cards.length}.`}
      />

      {error && (
        <div className="mb-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error}
        </div>
      )}

      {cards.length > 0 && (
        <Link href="/favorites/train" className="btn btn-primary btn-lg btn-block">
          Повторить избранное
          <Icon name="arrowRight" size={18} />
        </Link>
      )}

      {cards.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon tile-icon-warning">
            <Icon name="star" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">
            В избранном пока пусто. Нажмите на звёздочку у слова в папке — и оно появится здесь.
          </p>
          <Link href="/folders" className="btn btn-secondary mt-5">
            <Icon name="folder" size={18} />
            Мои папки
          </Link>
        </div>
      ) : (
        <>
          <h2 className="section-label">Слова</h2>
          <div className="flex flex-col gap-3">
            {cards.map(card => (
              <article key={card.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="text-lg">{card.word}</h3>
                      {card.transcription && (
                        <span className="font-mono text-[13px] text-[#8a8a96]">
                          {card.transcription}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[15px] text-[#b0b0bb]">{card.translation}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveFavorite(card.id)}
                    className="icon-btn shrink-0"
                    style={{ color: 'var(--warning)' }}
                    title="Убрать из избранного"
                    aria-label="Убрать из избранного"
                  >
                    <Icon name="star" size={18} />
                  </button>
                </div>

                {card.sentences && card.sentences.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-l-2 border-[#8ea2ff]/30 pl-3 text-[13px] leading-5 text-[#8a8a96]">
                    {card.sentences.slice(0, 3).map((sent, idx) => (
                      <p key={idx}>{sent}</p>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2 border-t border-[#24242b] pt-3">
                  <span className="chip">Уровень повторения: {card.srs_level}</span>
                  <span className={`chip ${card.wrong_count > 0 ? 'chip-danger' : ''}`}>
                    Ошибок: {card.wrong_count}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}