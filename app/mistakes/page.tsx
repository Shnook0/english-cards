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
    return <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">Загрузка...</div>
  }

  return (
    <div className="min-h-screen px-5 py-8 md:px-10 md:py-14">
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← На главную
          </Link>
          <span className="eyebrow">Личный лексикон</span>
        </div>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-[#24221e] pb-8">
          <div>
            <p className="eyebrow mb-3">Разбор ошибок</p>
            <h1 className="display text-5xl md:text-6xl">Частые ошибки</h1>
            <p className="mt-4 text-sm text-[#948e82]">
              Слова с двумя и более ошибками: {cards.length}
            </p>
          </div>
          {cards.length > 0 && (
            <Link href="/mistakes/train" className="btn btn-primary">
              Повторить
            </Link>
          )}
        </div>

        {cards.length === 0 ? (
          <div className="panel p-14 text-center">
            <p className="display text-3xl mb-3">Чисто</p>
            <p className="text-sm text-[#948e82]">
              Отличная работа! У вас нет слов с частыми ошибками.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.map(card => (
              <div key={card.id} className="panel panel-hover flex flex-col justify-between p-6">
                <div>
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <span className="font-[family-name:var(--font-display)] text-2xl">
                      {card.word}
                    </span>
                    <button
                      onClick={() => toggleFav(card.id, card.is_favorite)}
                      className={`text-lg transition ${
                        card.is_favorite
                          ? 'text-[#c9a96e]'
                          : 'text-[#514c44] hover:text-[#948e82]'
                      }`}
                      title="Избранное"
                    >
                      ★
                    </button>
                  </div>
                  {card.transcription && (
                    <p className="mb-2 text-sm text-[#948e82]">{card.transcription}</p>
                  )}
                  <p className="mb-4 text-base text-[#f2eee5]">{card.translation}</p>
                  {card.sentences && card.sentences.length > 0 && (
                    <div className="mb-4 space-y-2 border-l border-[#c9a96e]/30 pl-4 text-xs leading-6 text-[#948e82]">
                      {card.sentences.map((s, i) => (
                        <p key={i}>{s}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-[#24221e] pt-4 text-xs text-[#948e82]">
                  <span className="max-w-[140px] truncate">
                    Папка:{' '}
                    <strong className="font-medium text-[#f2eee5]">
                      {card.folders?.name || '—'}
                    </strong>
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-[#bb7464]">
                      Ошибок: {card.wrong_count}
                    </span>
                    <button
                      onClick={() => removeFromMistakes(card.id)}
                      className="text-[#bb7464] transition hover:opacity-75"
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