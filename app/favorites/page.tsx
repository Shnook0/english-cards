'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
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
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d10] text-[#8a8a96]">
        <span className="eyebrow">Загрузка избранного</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-7 lg:p-10">
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs">
            ← Библиотека
          </Link>
          <span className="eyebrow">Отобранное</span>
        </div>

        <header className="flex flex-col justify-between gap-6 border-b border-[#24242b] pb-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow mb-4">Личная подборка</p>
            <h1 className="display text-4xl md:text-5xl lg:text-6xl">
              Избранные <span className="text-[#8ea2ff]">★</span>
            </h1>
            <p className="mt-3 text-sm text-[#8a8a96]">{cards.length} карточек</p>
          </div>
          {cards.length > 0 && (
            <Link href="/favorites/train" className="btn btn-primary">
              Повторить
            </Link>
          )}
        </header>

        {error && (
          <div className="mt-8 border border-[#e5786f]/50 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
            {error}
          </div>
        )}

        <section className="py-7">
          {cards.length === 0 ? (
            <div className="panel flex min-h-48 flex-col items-center justify-center p-10 text-center">
              <p className="text-sm text-[#8a8a96]">В избранном пока нет карточек.</p>
              <p className="mt-2 text-xs text-[#6b6b76]">
                Отмечайте слова звёздочкой ★ в коллекциях.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <article
                  key={card.id}
                  className="panel flex flex-col justify-between p-4 transition hover:border-[#8ea2ff]/40"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-xs text-[#6b6b76]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <button
                        onClick={() => handleRemoveFavorite(card.id)}
                        className="text-base text-[#8ea2ff] hover:text-[#8a8a96]"
                        title="Убрать из избранного"
                      >
                        ★
                      </button>
                    </div>
                    <h3 className="mt-3 text-xl">{card.word}</h3>
                    {card.transcription && (
                      <p className="mt-1 font-mono text-xs text-[#8a8a96]">{card.transcription}</p>
                    )}
                    <p className="mt-3 text-sm leading-6 text-[#8ea2ff]">{card.translation}</p>
                    {card.sentences && card.sentences.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-[#24242b] pt-3 text-xs leading-5 text-[#8a8a96]">
                        {card.sentences.slice(0, 3).map((sent, idx) => (
                          <p key={idx}>{sent}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 border-t border-[#24242b] pt-3 text-xs text-[#6b6b76]">
                    SRS {card.srs_level} · ошибок {card.wrong_count}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}