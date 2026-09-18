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
      <div className="flex min-h-screen items-center justify-center bg-[#0f1115] text-[#e6e8ec]">
        <p>Загрузка...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        {/* Навигация назад */}
        <div className="mb-6">
          <Link href="/" className="text-sm text-[#8b90a0] hover:text-[#6c7cff] transition">
            ← На главную
          </Link>
        </div>

        {/* Заголовок и действия */}
        <div className="flex items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold mb-1 flex items-center gap-2">
              Избранные <span className="text-[#6c7cff]">★</span>
            </h1>
            <p className="text-sm text-[#8b90a0]">Всего карточек: {cards.length}</p>
          </div>

          {cards.length > 0 && (
            <Link
              href="/favorites/train"
              className="rounded-lg bg-[#6c7cff] px-5 py-2.5 font-medium text-white hover:bg-[#5865e0] transition"
            >
              Повторить
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm text-[#e6e8ec]">
            {error}
          </div>
        )}

        {/* Список избранных карточек */}
        {cards.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-12 text-center text-[#8b90a0]">
            В избранном пока нет карточек. Добавляйте их, нажимая на звёздочку ★ у нужных слов.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-lg font-bold text-[#e6e8ec]">{card.word}</span>
                    <button
                      onClick={() => handleRemoveFavorite(card.id)}
                      className="text-lg text-[#6c7cff] hover:text-gray-500 transition"
                      title="Убрать из избранного"
                    >
                      ★
                    </button>
                  </div>

                  {card.transcription && (
                    <p className="text-sm text-[#8b90a0] mb-2">{card.transcription}</p>
                  )}

                  <p className="text-md text-[#e6e8ec] font-medium mb-3">{card.translation}</p>

                  {card.sentences && card.sentences.length > 0 && (
                    <div className="mb-3 space-y-1 bg-[#0f1115] p-2.5 rounded-lg text-xs text-[#8b90a0]">
                      {card.sentences.map((sent, idx) => (
                        <p key={idx}>• {sent}</p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-xs text-[#8b90a0] pt-3 border-t border-gray-800/50">
                  SRS: {card.srs_level} | Ошибок: {card.wrong_count}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}