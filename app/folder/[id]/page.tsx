'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card, Folder } from '@/types/database'
import AddCardModal from '@/components/AddCardModal'
import MatchRecord from '@/components/MatchRecord'

export default function FolderPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
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
    setLoading(true)
    setError(null)

    const { data: f, error: fErr } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .single()

    if (fErr || !f) {
      setError('Папка не найдена')
      setLoading(false)
      return
    }
    setFolder(f as Folder)

    let q = supabase.from('cards').select('*')
    if (f.type === 'learned') {
      q = q.not('learned_at', 'is', null).order('learned_at', { ascending: true })
    } else {
      q = q.eq('folder_id', folderId).order('created_at', { ascending: false })
    }
    const { data: c, error: cErr } = await q
    if (cErr) setError('Ошибка загрузки карточек')
    else setCards((c ?? []) as Card[])
    setLoading(false)
  }, [folderId])

  useEffect(() => {
    if (user && folderId) void load()
  }, [user, folderId, load])

  const toggleFav = async (card: Card) => {
    const newVal = !card.is_favorite
    await supabase.from('cards').update({ is_favorite: newVal }).eq('id', card.id)
    setCards(prev => prev.map(c => (c.id === card.id ? { ...c, is_favorite: newVal } : c)))
  }

  const removeCard = async (card: Card) => {
    let deleteOnlyThis = true

    if (card.sync_group_id) {
      deleteOnlyThis = window.confirm(
        'Это слово связано с копиями в других папках.\nОК = удалить только из этой папки.\nОтмена = удалить отовсюду.'
      )

      if (deleteOnlyThis) {
        await supabase.from('cards').delete().eq('id', card.id)
      } else {
        const deleteAll = window.confirm('Удалить ВСЕ копии этого слова?')
        if (deleteAll) {
          await supabase.from('cards').delete().eq('sync_group_id', card.sync_group_id)
        } else {
          return
        }
      }
    } else {
      if (!confirm('Удалить карточку?')) return
      await supabase.from('cards').delete().eq('id', card.id)
    }

    if (deleteOnlyThis) {
      setCards(prev => prev.filter(c => c.id !== card.id))
    } else {
      load()
    }
  }

  const deleteFolder = async () => {
    if (!folder || folder.type === 'learned') return
    if (!confirm(`Удалить папку «${folder.name}» и все её карточки?`)) return
    await supabase.from('folders').delete().eq('id', folder.id)
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
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загрузка коллекции</span>
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#090909] p-4 text-[#f2eee5]">
        <p className="mb-4 text-[#bb7464]">{error || 'Папка не найдена'}</p>
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
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← Библиотека
          </Link>
          <span className="eyebrow">
            {isLearnedFolder ? 'Архив' : isLevelFolder ? 'Уровень' : 'Коллекция'}
          </span>
        </div>

        <header className="grid gap-5 border-b border-[#24221e] pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="eyebrow mb-3">{isLevelFolder ? 'CEFR collection' : 'Personal collection'}</p>
            <h1 className="display text-4xl md:text-5xl lg:text-6xl">{folder.name}</h1>
            <p className="mt-3 text-sm text-[#948e82]">
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
                className="btn btn-ghost text-[#bb7464] hover:text-[#d9a093]"
              >
                Удалить
              </button>
            )}
          </div>
        </header>

        {!isLearnedFolder && cards.length > 0 && (
          <section className="border-b border-[#24221e] py-5">
            <div className="mb-4 text-center">
              <h2 className="display text-2xl">Выберите режим для повторения</h2>
              <p className="mt-1 text-xs text-[#948e82]">
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
                    <span className="font-mono text-[10px] text-[#c9a96e]">1</span>
                    <h3 className="text-lg font-medium">Заучивание</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b5aea1]">Пропуски → написание</p>
                </div>
                <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/match`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-[#c9a96e]">2</span>
                    <h3 className="text-lg font-medium">Подбор</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b5aea1]">
                    Пары на скорость <MatchRecord scope={`folder:${folderId}`} />
                  </p>
                </div>
                <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/blocks`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-[#c9a96e]">3</span>
                    <h3 className="text-lg font-medium">Блоки</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b5aea1]">Перевод и головоломка</p>
                </div>
                <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href={`/folder/${folderId}/play/dictation`}
                className="panel panel-hover group flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-[#c9a96e]">4</span>
                    <h3 className="text-lg font-medium">Диктант</h3>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[#b5aea1]">Письмо на слух</p>
                </div>
                <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
              </Link>
            </div>
          </section>
        )}

        {!isLearnedFolder && unlearnedCards.length > 0 && (
          <details className="group border-b border-[#24221e] py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[0.16em] text-[#948e82]">
              <span>Осталось выучить · {unlearnedCards.length}</span>
              <span className="text-[#c9a96e] transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4 flex flex-wrap gap-2">
              {unlearnedCards.map(c => (
                <span key={c.id} className="border border-[#24221e] bg-[#111110] px-2.5 py-1.5 text-xs text-[#948e82]">
                  <span className="text-[#f2eee5]">{c.word}</span>
                  <span className="mx-1 text-[#514c44]">/</span>
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
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#6f6a61]">
              {cards.length} всего
            </span>
          </div>

          {cards.length === 0 ? (
            <div className="panel flex min-h-48 flex-col items-center justify-center p-10 text-center">
              <p className="text-sm text-[#948e82]">
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
                  className="panel group flex flex-col justify-between p-4 transition hover:border-[#c9a96e]/40"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-[9px] text-[#6f6a61]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-2">
                        {card.learned_at && (
                          <span className="border border-[#6f8a72]/40 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#9fb59f]">
                            выучено
                          </span>
                        )}
                        {card.sync_group_id && (
                          <span className="text-[10px] text-[#c9a96e]" title="Связано с другими копиями">↗</span>
                        )}
                        <button
                          onClick={() => toggleFav(card)}
                          className={`text-base transition ${card.is_favorite ? 'text-[#c9a96e]' : 'text-[#514c44] hover:text-[#948e82]'}`}
                          title="Избранное"
                        >
                          ★
                        </button>
                      </div>
                    </div>

                    <h3 className="mt-4 text-xl leading-tight">{card.word}</h3>
                    {card.transcription && (
                      <p className="mt-1 font-mono text-[11px] text-[#948e82]">{card.transcription}</p>
                    )}
                    <p className="mt-3 text-sm leading-6 text-[#c9a96e]">{card.translation}</p>

                    {card.sentences && card.sentences.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-[#24221e] pt-3 text-[11px] leading-5 text-[#948e82]">
                        {card.sentences.slice(0, 3).map((s, i) => (
                          <p key={i}>{s}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#24221e] pt-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#6f6a61]">
                      SRS {card.srs_level} · ошибок {card.wrong_count}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenEdit(card)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#2d2a25] bg-[#171612] px-3 py-2 text-[11px] font-medium text-[#d8d2c7] transition hover:border-[#c9a96e]/60 hover:bg-[#c9a96e]/10 hover:text-[#c9a96e]"
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#bb7464]/40 bg-[#bb7464]/10 px-3 py-2 text-[11px] font-medium text-[#d9a093] transition hover:border-[#bb7464] hover:bg-[#bb7464]/20 hover:text-[#f0c0b4]"
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