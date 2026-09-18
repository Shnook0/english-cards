'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'

type CardWithFolder = Card & { folders?: { name: string } | null }

export default function MistakesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [cards, setCards] = useState<CardWithFolder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) load()
  }, [user])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cards')
      .select('*, folders(name)')
      .gte('wrong_count', 2)
      .order('wrong_count', { ascending: false })
    setCards((data as CardWithFolder[]) || [])
    setLoading(false)
  }

  const toggleFav = async (cardId: string, current: boolean) => {
    await supabase.from('cards').update({ is_favorite: !current }).eq('id', cardId)
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, is_favorite: !current } : c))
  }

  const removeFromMistakes = async (cardId: string) => {
    if (!confirm('Убрать слово из «Частых ошибок»? Счётчик ошибок обнулится.')) return
    await supabase.from('cards').update({ wrong_count: 0 }).eq('id', cardId)
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  if (authLoading || loading) {
    return <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">Загрузка...</div>
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-sm text-[#8b90a0] hover:text-[#6c7cff]">← На главную</Link>
        </div>

        <div className="flex items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold mb-1">Частые ошибки</h1>
            <p className="text-sm text-[#8b90a0]">Слова с 2 и более ошибками: {cards.length}</p>
          </div>
          {cards.length > 0 && (
            <Link
              href="/mistakes/train"
              className="rounded-lg bg-[#6c7cff] px-5 py-2.5 font-medium text-white hover:bg-[#5865e0] transition"
            >
              Повторить
            </Link>
          )}
        </div>

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-12 text-center text-[#8b90a0]">
            Отличная работа! У вас нет слов с частыми ошибками.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map(card => (
              <div key={card.id} className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-lg font-bold">{card.word}</span>
                    <button
                      onClick={() => toggleFav(card.id, card.is_favorite)}
                      className={`text-lg transition ${card.is_favorite ? 'text-[#6c7cff]' : 'text-gray-600 hover:text-gray-400'}`}
                      title="Избранное"
                    >
                      ★
                    </button>
                  </div>
                  {card.transcription && <p className="text-sm text-[#8b90a0] mb-2">{card.transcription}</p>}
                  <p className="text-md font-medium mb-3">{card.translation}</p>
                  {card.sentences && card.sentences.length > 0 && (
                    <div className="mb-3 space-y-1 bg-[#0f1115] p-2.5 rounded-lg text-xs text-[#8b90a0]">
                      {card.sentences.map((s, i) => <p key={i}>• {s}</p>)}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-[#8b90a0] pt-3 border-t border-gray-800/50">
                  <span className="truncate max-w-[140px]">
                    Папка: <strong className="text-[#e6e8ec]">{card.folders?.name || '—'}</strong>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[#a04a4a] font-medium">Ошибок: {card.wrong_count}</span>
                    <button
                      onClick={() => removeFromMistakes(card.id)}
                      className="text-[#a04a4a] hover:opacity-80 transition"
                      title="Убрать из частых ошибок"
                    >
                      Убрать
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}