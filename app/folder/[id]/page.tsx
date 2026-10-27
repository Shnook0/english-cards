'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card, Folder } from '@/types/database'
import AddCardModal from '@/components/AddCardModal'
import MatchRecord from '@/components/MatchRecord'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
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
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем папку…</span>
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="page page-in">
        <PageHeader back={{ href: '/', label: 'Главная' }} title="Папка недоступна" />
        <div className="rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error || 'Папка не найдена'}
        </div>
      </div>
    )
  }

  const isLearnedFolder = folder.type === 'learned'
  const isLevelFolder = folder.type === 'level'

  const learnedCards = cards.filter(c => c.learned_at)
  const unlearnedCards = cards.filter(c => !c.learned_at)
  const learnedPercent = cards.length > 0 ? Math.round((learnedCards.length / cards.length) * 100) : 0

  const description = isLearnedFolder
    ? 'Здесь собраны слова, которые вы уже выучили. Повторяйте их иногда, чтобы не забыть.'
    : isLevelFolder
    ? 'Готовый набор слов этого уровня. Учите по карточкам или выберите режим тренировки.'
    : 'Ваша папка со словами. Добавляйте слова и тренируйте их в удобном режиме.'

  const openAdd = () => {
    setCardToEdit(null)
    setIsAddModalOpen(true)
  }

  const modes = [
    {
      href: `/folder/${folderId}/play/learn`,
      icon: 'book' as const,
      title: 'Заучивание',
      text: <>Сначала пропуски, потом пишете слово целиком</>,
    },
    {
      href: `/folder/${folderId}/play/match`,
      icon: 'spark' as const,
      title: 'Подбор',
      text: (
        <>
          Соединяйте слово и перевод на скорость <MatchRecord scope={`folder:${folderId}`} />
        </>
      ),
    },
    {
      href: `/folder/${folderId}/play/blocks`,
      icon: 'layers' as const,
      title: 'Блоки',
      text: <>Перевод и сборка слова из блоков</>,
    },
    {
      href: `/folder/${folderId}/play/dictation`,
      icon: 'target' as const,
      title: 'Диктант',
      text: <>Слушаете слово и пишете его</>,
    },
  ]

  return (
    <div className="page page-in">
      <PageHeader back={{ href: '/', label: 'Главная' }} title={folder.name} description={description} />

      <section className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <span className="stat-number">{cards.length}</span>
            <span className="text-[15px] text-[#8a8a96]">слов</span>
          </p>
          {!isLearnedFolder && (
            <span className="text-sm text-[#b0b0bb]">
              выучено {learnedCards.length} · {learnedPercent}%
            </span>
          )}
        </div>
        {!isLearnedFolder && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#24242b]">
            <div className="h-full rounded-full bg-[#7fc8a0]" style={{ width: `${learnedPercent}%` }} />
          </div>
        )}

        {(cards.length > 0 || !isLearnedFolder) && (
          <div className="mt-5 flex gap-2">
            {cards.length > 0 && (
              <Link href={`/folder/${folderId}/train`} className="btn btn-primary min-w-0 flex-1">
                Учить слова
              </Link>
            )}
            {!isLearnedFolder && (
              <button onClick={openAdd} className="btn btn-secondary min-w-0 flex-1">
                <Icon name="plus" size={18} />
                Добавить
              </button>
            )}
          </div>
        )}
        {cards.length > 0 && (
          <p className="mt-2.5 text-center text-xs text-[#6b6b76]">
            Показываем слово — отвечаете «Знаю» или «Не знаю»
          </p>
        )}
      </section>

      {!isLearnedFolder && cards.length > 0 && (
        <>
          <h2 className="section-label flex items-center justify-between">
            <span>Режимы тренировки</span>
            <span className="font-normal text-[#6b6b76]">{unlearnedCards.length} к изучению</span>
          </h2>
          <section className="grid grid-cols-2 gap-3">
            {modes.map(mode => (
              <Link key={mode.href} href={mode.href} className="tile">
                <span className="tile-icon">
                  <Icon name={mode.icon} />
                </span>
                <div>
                  <p className="tile-title">{mode.title}</p>
                  <p className="tile-text">{mode.text}</p>
                </div>
              </Link>
            ))}
          </section>
        </>
      )}

      {!isLearnedFolder && unlearnedCards.length > 0 && (
        <details className="group card mt-3 px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-[#b0b0bb]">
            <span>Ещё не выучены · {unlearnedCards.length}</span>
            <span className="text-[#8ea2ff] transition group-open:rotate-45">
              <Icon name="plus" size={18} />
            </span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {unlearnedCards.map(c => (
              <span key={c.id} className="chip">
                <span className="text-[#ececf1]">{c.word}</span>
                <span className="text-[#6b6b76]">—</span>
                {c.translation}
              </span>
            ))}
          </div>
        </details>
      )}

      <h2 className="section-label flex items-center justify-between">
        <span>Слова</span>
        <span className="font-normal text-[#6b6b76]">{cards.length}</span>
      </h2>

      {cards.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <p className="text-sm text-[#8a8a96]">
            {isLearnedFolder ? 'У вас пока нет выученных слов.' : 'В этой папке пока нет слов.'}
          </p>
          {!isLearnedFolder && (
            <button onClick={openAdd} className="btn btn-primary mt-5">
              <Icon name="plus" size={18} />
              Добавить первое слово
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map(card => (
            <article key={card.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-tight break-words text-[#ececf1]">
                    {card.word}
                  </h3>
                  {card.transcription && (
                    <p className="mt-1 font-mono text-xs text-[#8a8a96]">{card.transcription}</p>
                  )}
                  <p className="mt-1.5 text-[15px] leading-6 text-[#8ea2ff]">{card.translation}</p>
                </div>
                <button
                  onClick={() => toggleFav(card)}
                  className="icon-btn shrink-0"
                  title="Избранное"
                  aria-label={card.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                  aria-pressed={card.is_favorite}
                >
                  <Icon
                    name="star"
                    size={20}
                    className={card.is_favorite ? 'fill-current text-[#e8c27a]' : 'text-[#6b6b76]'}
                  />
                </button>
              </div>

              {card.sentences && card.sentences.length > 0 && (
                <div className="mt-3 space-y-1 border-l-2 border-[#24242b] pl-3 text-sm leading-5 text-[#8a8a96]">
                  {card.sentences.slice(0, 3).map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {card.learned_at && <span className="chip chip-success">выучено</span>}
                {card.sync_group_id && (
                  <span className="chip chip-accent" title="Связано с другими копиями">
                    есть копии
                  </span>
                )}
                <span className="chip">уровень {card.srs_level}</span>
                <span className={`chip ${card.wrong_count > 0 ? 'chip-danger' : ''}`}>
                  ошибок {card.wrong_count}
                </span>
              </div>

              <div className="mt-3 flex gap-2 border-t border-[#24242b] pt-3">
                <button onClick={() => handleOpenEdit(card)} className="btn btn-secondary btn-sm flex-1">
                  Изменить
                </button>
                <button
                  onClick={() => removeCard(card)}
                  className="btn btn-danger btn-sm flex-1"
                >
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {!isLearnedFolder && !isLevelFolder && (
        <div className="mt-8 flex justify-center">
          <button onClick={deleteFolder} className="btn btn-ghost btn-sm">
            <span className="text-[#e5786f]">Удалить папку</span>
          </button>
        </div>
      )}

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
