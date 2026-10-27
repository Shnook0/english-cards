'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card, Folder } from '@/types/database'
import AddCardModal from '@/components/AddCardModal'
import MatchRecord from '@/components/MatchRecord'
import {
  deleteCard,
  deleteCardsByGroup,
  deleteFolder as deleteFolderLocal,
  fetchCards,
  fetchFolder,
  setFavorite,
} from '@/lib/offline/repo'

export default function FolderPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useOfflineRouter()
  const folderId = params.id as string

  const [folder, setFolder] = useState<Folder | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [cardToEdit, setCardToEdit] = useState<Card | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const f = await fetchFolder(folderId)
    if (!f) {
      setError('Папка не найдена')
      setLoading(false)
      return
    }
    setFolder(f)

    const c =
      f.type === 'learned'
        ? await fetchCards({ userId: user.id, learned: true, order: 'learned_asc' })
        : await fetchCards({ userId: user.id, folderId, order: 'created_desc' })

    setCards(c)
    setLoading(false)
  }, [folderId, user])

  useEffect(() => {
    if (user && folderId) void load()
  }, [user, folderId, load])

  const toggleFav = async (card: Card) => {
    const newVal = !card.is_favorite
    const ok = await setFavorite(card.id, newVal)
    if (!ok) {
      setError('Не удалось изменить избранное')
      return
    }
    setCards(prev => prev.map(c => (c.id === card.id ? { ...c, is_favorite: newVal } : c)))
  }

  const removeCard = async (card: Card) => {
    let deleteOnlyThis = true

    if (card.sync_group_id) {
      deleteOnlyThis = window.confirm(
        'Это слово связано с копиями в других папках.\nОК = удалить только из этой папки.\nОтмена = удалить отовсюду.'
      )

      if (deleteOnlyThis) {
        await deleteCard(card.id)
      } else {
        const deleteAll = window.confirm('Удалить ВСЕ копии этого слова?')
        if (deleteAll) {
          await deleteCardsByGroup(card.sync_group_id)
        } else {
          return
        }
      }
    } else {
      if (!confirm('Удалить карточку?')) return
      await deleteCard(card.id)
    }

    if (deleteOnlyThis) {
      setCards(prev => prev.filter(c => c.id !== card.id))
    } else {
      void load()
    }
  }

  const deleteFolder = async () => {
    if (!folder || folder.type === 'learned') return
    if (!confirm(`Удалить папку «${folder.name}» и все её карточки?`)) return
    try {
      await deleteFolderLocal(folder.id)
    } catch {
      setError('Не удалось удалить папку')
      return
    }
    router.push('/')
  }

  const handleOpenEdit = (card: Card) => {
    setCardToEdit(card)
    setIsAddModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsAddModalOpen(false)
    setCardToEdit(null)
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d10] text-[#8a8a96]">
        <span className="eyebrow">Загрузка коллекции</span>
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0d0d10] p-4 text-[#ececf1]">
        <p className="mb-4 text-[#e5786f]">{error || 'Папка не найдена'}</p>
        <Link href="/" className="link-muted text-sm">← На главную</Link>
      </div>
    )
  }

  const isLearnedFolder = folder.type === 'learned'
  const isLevelFolder = folder.type === 'level'

  const learnedCards = cards.filter(c => c.learned_at)
  const unlearnedCards = cards.filter(c => !c.learned_at)
  const learnedPercent = cards.length > 0 ? Math.round((learnedCards.length / cards.length) * 100) : 0

  return (
    <div className="min-h-screen p-4 md:p-7 lg:p-10">
      <div className="page-in mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs">
            ← Библиотека
          </Link>
          <span className="eyebrow">
            {isLearnedFolder ? 'Архив' : isLevelFolder ? 'Уровень' : 'Коллекция'}
          </span>
        </div>

        <header className="grid gap-5 border-b border-[#24242b] pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="eyebrow mb-3">{isLevelFolder ? 'CEFR collection' : 'Personal collection'}</p>
            <h1 className="display text-4xl md:text-5xl lg:text-6xl">{folder.name}</h1>
            <p className="mt-3 text-sm text-[#8a8a96]">
              {cards.length} слов
              {!isLearnedFolder && <> · выучено {learnedCards.length} ({learnedPercent}%)</>}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {cards.length > 0 && (
              <Link href={`/folder/${folderId}/train`} className="btn btn-primary">
                Учить
              </Link>
            )}
            {!isLearnedFolder && (
              <button
                onClick={() => { setCardToEdit(null); setIsAddModalOpen(true) }}
                className="btn btn-secondary"
              >
                + Карточка
              </button>
            )}
            {!isLearnedFolder && !isLevelFolder && (
              <button
                onClick={deleteFolder}
                className="btn btn-ghost text-[#e5786f] hover:text-[#f0a39b]"
              >
                Удалить
              </button>
            )}
          </div>
        </header>

        {!isLearnedFolder && cards.length > 0 && (
          <section className="border-b border-[#24242b] py-5">
            <div className="mb-4 text-center">
              <h2 className="display text-2xl">Выберите режим для повторения</h2>
              <p className="mt-1 text-xs text-[#8a8a96]">
                {unlearnedCards.length} к изучению
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Link
                href={`/folder/${folderId}/play/learn`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[#8ea2ff]">1</span>
                    <h3 className="text-lg font-medium">Заучивание</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b0b0bb]">Пропуски → написание</p>
                </div>
                <span className="text-[#8ea2ff] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/match`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[#8ea2ff]">2</span>
                    <h3 className="text-lg font-medium">Подбор</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b0b0bb]">
                    Пары на скорость <MatchRecord scope={`folder:${folderId}`} />
                  </p>
                </div>
                <span className="text-[#8ea2ff] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/blocks`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[#8ea2ff]">3</span>
                    <h3 className="text-lg font-medium">Блоки</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b0b0bb]">Перевод и головоломка</p>
                </div>
                <span className="text-[#8ea2ff] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/dictation`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[#8ea2ff]">4</span>
                    <h3 className="text-lg font-medium">Диктант</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b0b0bb]">Письмо на слух</p>
                </div>
                <span className="text-[#8ea2ff] transition group-hover:translate-x-0.5">→</span>
              </Link>
            </div>
          </section>
        )}

        {!isLearnedFolder && unlearnedCards.length > 0 && (
          <details className="group border-b border-[#24242b] py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs text-[#8a8a96]">
              <span>Осталось выучить · {unlearnedCards.length}</span>
              <span className="text-[#8ea2ff] transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4 flex flex-wrap gap-2">
              {unlearnedCards.map(c => (
                <span key={c.id} className="border border-[#24242b] bg-[#15151a] px-2.5 py-1.5 text-xs text-[#8a8a96]">
                  <span className="text-[#ececf1]">{c.word}</span>
                  <span className="mx-1 text-[#4c4c57]">/</span>
                  {c.translation}
                </span>
              ))}
            </div>
          </details>
        )}

        <section className="py-7">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="eyebrow">Словарь</p>
              <h2 className="mt-1.5 text-xl">Карточки</h2>
            </div>
            <span className="text-xs text-[#6b6b76]">
              {cards.length} всего
            </span>
          </div>

          {cards.length === 0 ? (
            <div className="panel flex min-h-48 flex-col items-center justify-center p-10 text-center">
              <p className="text-sm text-[#8a8a96]">
                {isLearnedFolder ? 'У вас пока нет выученных слов.' : 'В этой папке пока нет карточек.'}
              </p>
              {!isLearnedFolder && (
                <button
                  onClick={() => { setCardToEdit(null); setIsAddModalOpen(true) }}
                  className="btn btn-primary mt-5"
                >
                  Добавить первую
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <article
                  key={card.id}
                  className="panel group flex flex-col justify-between p-4 transition hover:border-[#8ea2ff]/40"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-xs text-[#6b6b76]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-2">
                        {card.learned_at && (
                          <span className="border border-[#5fae84]/40 px-1.5 py-0.5 text-xs text-[#7fc8a0]">
                            выучено
                          </span>
                        )}
                        {card.sync_group_id && (
                          <span className="text-xs text-[#8ea2ff]" title="Связано с другими копиями">↗</span>
                        )}
                        <button
                          onClick={() => toggleFav(card)}
                          className={`text-base transition ${card.is_favorite ? 'text-[#8ea2ff]' : 'text-[#4c4c57] hover:text-[#8a8a96]'}`}
                          title="Избранное"
                        >
                          ★
                        </button>
                      </div>
                    </div>

                    <h3 className="mt-4 text-xl leading-tight">{card.word}</h3>
                    {card.transcription && (
                      <p className="mt-1 font-mono text-xs text-[#8a8a96]">{card.transcription}</p>
                    )}
                    <p className="mt-3 text-sm leading-6 text-[#8ea2ff]">{card.translation}</p>

                    {card.sentences && card.sentences.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-[#24242b] pt-3 text-xs leading-5 text-[#8a8a96]">
                        {card.sentences.slice(0, 3).map((s, i) => (
                          <p key={i}>{s}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#24242b] pt-3">
                    <span className="font-mono text-xs text-[#6b6b76]">
                      SRS {card.srs_level} · ошибок {card.wrong_count}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenEdit(card)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#2c2c34] bg-[#1a1a20] px-3 py-2 text-xs font-medium text-[#d4d4dc] transition hover:border-[#8ea2ff]/60 hover:bg-[#8ea2ff]/10 hover:text-[#8ea2ff]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.6}
                          stroke="currentColor"
                          className="h-3.5 w-3.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 7.125L16.862 4.487"
                          />
                        </svg>
                        Изменить
                      </button>
                      <button
                        onClick={() => removeCard(card)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5786f]/40 bg-[#e5786f]/10 px-3 py-2 text-xs font-medium text-[#f0a39b] transition hover:border-[#e5786f] hover:bg-[#e5786f]/20 hover:text-[#f4b8b1]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.6}
                          stroke="currentColor"
                          className="h-3.5 w-3.5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L5.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                          />
                        </svg>
                        Удалить
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <AddCardModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        folderId={folderId}
        userId={user!.id}
        onCardAdded={load}
        cardToEdit={cardToEdit}
      />
    </div>
  )
}