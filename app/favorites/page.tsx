'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'

export default function FavoritesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      fetchFavoriteCards()
    }
  }, [user])

  const fetchFavoriteCards = async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', user!.id)
      .eq('is_favorite', true)
      .order('created_at', { ascending: false })

    if (error) {
      setError('Ошибка при загрузке избранных карточек')
    } else {
      setCards(data || [])
    }
    setLoading(false)
  }

  const handleRemoveFavorite = async (cardId: string) => {
    const { error } = await supabase
      .from('cards')
      .update({ is_favorite: false })
      .eq('id', cardId)

    if (!error) {
      setCards(cards.filter(c => c.id !== cardId))
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загрузка избранного</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-5 md:p-10 lg:p-14">
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← Библиотека
          </Link>
          <span className="eyebrow">Отобранное</span>
        </div>

        <header className="flex flex-col justify-between gap-6 border-b border-[#24221e] pb-10 md:flex-row md:items-end">
          <div>
            <p className="eyebrow mb-4">Личная подборка</p>
            <h1 className="display text-5xl md:text-7xl">
              Избранные <span className="text-[#c9a96e]">★</span>
            </h1>
            <p className="mt-5 text-sm text-[#948e82]">{cards.length} карточек</p>
          </div>
          {cards.length > 0 && (
            <Link href="/favorites/train" className="btn btn-primary">
              Повторить
            </Link>
          )}
        </header>

        {error && (
          <div className="mt-8 border border-[#bb7464]/50 bg-[#bb7464]/10 px-4 py-3 text-sm text-[#d9a093]">
            {error}
          </div>
        )}

        <section className="py-10">
          {cards.length === 0 ? (
            <div className="panel flex min-h-48 flex-col items-center justify-center p-10 text-center">
              <p className="text-sm text-[#948e82]">В избранном пока нет карточек.</p>
              <p className="mt-2 text-xs text-[#6f6a61]">
                Отмечайте слова звёздочкой ★ в коллекциях.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <article
                  key={card.id}
                  className="panel flex min-h-60 flex-col justify-between p-5 transition hover:border-[#c9a96e]/40"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-[9px] text-[#6f6a61]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <button
                        onClick={() => handleRemoveFavorite(card.id)}
                        className="text-base text-[#c9a96e] hover:text-[#948e82]"
                        title="Убрать из избранного"
                      >
                        ★
                      </button>
                    </div>
                    <h3 className="mt-4 text-2xl">{card.word}</h3>
                    {card.transcription && (
                      <p className="mt-1 font-mono text-[11px] text-[#948e82]">{card.transcription}</p>
                    )}
                    <p className="mt-4 text-sm leading-6 text-[#c9a96e]">{card.translation}</p>
                    {card.sentences && card.sentences.length > 0 && (
                      <div className="mt-4 space-y-1.5 border-t border-[#24221e] pt-4 text-[11px] leading-5 text-[#948e82]">
                        {card.sentences.slice(0, 3).map((sent, idx) => (
                          <p key={idx}>{sent}</p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-5 border-t border-[#24221e] pt-3 text-[9px] uppercase tracking-[0.14em] text-[#6f6a61]">
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