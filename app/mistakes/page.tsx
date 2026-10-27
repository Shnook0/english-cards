'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
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
    return <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center">Загрузка...</div>
  }

  return (
    <div className="min-h-screen px-5 py-8 md:px-10 md:py-14">
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs">
            ← На главную
          </Link>
          <span className="eyebrow">Личный лексикон</span>
        </div>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-[#24242b] pb-8">
          <div>
            <p className="eyebrow mb-3">Разбор ошибок</p>
            <h1 className="display text-5xl md:text-6xl">Частые ошибки</h1>
            <p className="mt-4 text-sm text-[#8a8a96]">
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
            <p className="text-sm text-[#8a8a96]">
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
                          ? 'text-[#8ea2ff]'
                          : 'text-[#4c4c57] hover:text-[#8a8a96]'
                      }`}
                      title="Избранное"
                    >
                      ★
                    </button>
                  </div>
                  {card.transcription && (
                    <p className="mb-2 text-sm text-[#8a8a96]">{card.transcription}</p>
                  )}
                  <p className="mb-4 text-base text-[#ececf1]">{card.translation}</p>
                  {card.sentences && card.sentences.length > 0 && (
                    <div className="mb-4 space-y-2 border-l border-[#8ea2ff]/30 pl-4 text-xs leading-6 text-[#8a8a96]">
                      {card.sentences.map((s, i) => (
                        <p key={i}>{s}</p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-[#24242b] pt-4 text-xs text-[#8a8a96]">
                  <span className="max-w-[140px] truncate">
                    Папка:{' '}
                    <strong className="font-medium text-[#ececf1]">
                      {card.folders?.name || '—'}
                    </strong>
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-[#e5786f]">
                      Ошибок: {card.wrong_count}
                    </span>
                    <button
                      onClick={() => removeFromMistakes(card.id)}
                      className="text-[#e5786f] transition hover:opacity-75"
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