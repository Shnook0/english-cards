'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import RuPron from '@/components/ui/RuPron'
import SearchInput, { matchesQuery } from '@/components/ui/SearchInput'
import { Card, Folder } from '@/types/database'
import { isHard } from '@/lib/hard'
import { clearHardWord, fetchCards, fetchFolder } from '@/lib/offline/repo'

export default function HardWordsPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useOfflineRouter()
  const folderId = params.id as string

  const [folder, setFolder] = useState<Folder | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [f, all] = await Promise.all([
      fetchFolder(folderId),
      fetchCards({ userId: user.id, folderId, order: 'wrong_desc' }),
    ])
    setFolder(f)
    setCards(all.filter(isHard))
    setLoading(false)
  }, [user, folderId])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const removeWord = async (cardId: string) => {
    await clearHardWord(cardId)
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем сложные слова…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: `/folder/${folderId}`, label: folder?.name ?? 'Папка' }}
        title="Сложные слова"
        description={`Слова, на которых вы ошиблись 2 раза. Уходят, когда вы дважды подряд ответите «Знаю», а через 12+ часов (обычно на следующий день) — ещё раз дважды подряд. Сейчас: ${cards.length}.`}
      />

      {cards.length > 0 && (
        <Link href={`/folder/${folderId}/hard/train`} className="btn btn-primary btn-lg btn-block">
          Повторить сложные
          <Icon name="arrowRight" size={18} />
        </Link>
      )}

      {cards.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon tile-icon-success">
            <Icon name="check" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">
            Сложных слов в этой папке нет. Слово появится здесь после двух ответов «Не знаю».
          </p>
          <Link href={`/folder/${folderId}`} className="btn btn-secondary mt-5">
            К папке
          </Link>
        </div>
      ) : (
        <>
          <h2 className="section-label">Слова</h2>
          <SearchInput value={query} onChange={setQuery} />
          <div className="flex flex-col gap-3">
            {cards
              .filter(c => matchesQuery(query, c.word, c.translation, c.sentences))
              .map(card => (
                <div key={card.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-lg font-semibold">
                        {card.word}
                        <RuPron value={card.pronunciation_ru} />
                      </span>
                        {card.transcription && (
                          <span className="font-mono text-[13px] text-[#8a8a96]">
                            {card.transcription}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[15px] text-[#b0b0bb]">{card.translation}</p>
                    </div>
                    <button
                      onClick={() => removeWord(card.id)}
                      className="btn btn-ghost btn-sm shrink-0"
                      title="Убрать из сложных слов"
                    >
                      Убрать
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-[#24242b] pt-3">
                    <span className="chip">
                      {card.hard_confirmed_at
                        ? 'Нужна проверка в другой день'
                        : 'Нужно 2 «Знаю» подряд'}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
