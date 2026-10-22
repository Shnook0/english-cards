'use client'

import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (user && folderId) load()
  }, [user, folderId])

  const load = async () => {
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
  }

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
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#a04a4a]">{error || 'Папка не найдена'}</p>
        <Link href="/" className="text-sm text-[#6c7cff] hover:underline">← На главную</Link>
      </div>
    )
  }

  const isLearnedFolder = folder.type === 'learned'
  const isLevelFolder = folder.type === 'level'

  const learnedCards = cards.filter(c => c.learned_at)
  const unlearnedCards = cards.filter(c => !c.learned_at)

  const modeButtonClass =
    'rounded-lg border border-gray-700 bg-[#1a1d23] px-5 py-2.5 font-medium hover:border-[#6c7cff] transition'

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-sm text-[#8b90a0] hover:text-[#6c7cff] transition">← На главную</Link>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold mb-1">{folder.name}</h1>
            <p className="text-sm text-[#8b90a0]">
              Всего слов: {cards.length}
              {!isLearnedFolder && <> · Выучено: {learnedCards.length} / {cards.length}</>}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {cards.length > 0 && (
              <Link
                href={`/folder/${folderId}/train`}
                className="rounded-lg bg-[#6c7cff] px-5 py-2.5 font-medium text-white hover:bg-[#5865e0] transition"
              >
                Учить
              </Link>
            )}
            {!isLearnedFolder && cards.length > 0 && (
              <>
                <Link
                  href={`/folder/${folderId}/play/learn`}
                  className="rounded-lg border border-[#6c7cff] px-5 py-2.5 font-medium text-[#6c7cff] hover:bg-[#6c7cff]/10 transition"
                >
                  Заучивание
                </Link>
                <Link href={`/folder/${folderId}/play/match`} className={modeButtonClass}>
                  Подбор
                  <MatchRecord scope={`folder:${folderId}`} />
                </Link>
                <Link href={`/folder/${folderId}/play/blocks`} className={modeButtonClass}>
                  Блоки
                </Link>
                <Link href={`/folder/${folderId}/play/dictation`} className={modeButtonClass}>
                  Диктант
                </Link>
              </>
            )}
            {!isLearnedFolder && (
              <>
                <button
                  onClick={() => { setCardToEdit(null); setIsAddModalOpen(true) }}
                  className="rounded-lg border border-gray-700 bg-[#1a1d23] px-5 py-2.5 font-medium hover:border-[#6c7cff] transition"
                >
                  + Добавить карточку
                </button>
                {!isLevelFolder && (
                  <button
                    onClick={deleteFolder}
                    className="rounded-lg border border-[#a04a4a] px-4 py-2.5 font-medium text-[#a04a4a] hover:bg-[#a04a4a]/10 transition text-sm"
                  >
                    Удалить папку
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {!isLearnedFolder && unlearnedCards.length > 0 && (
          <details className="mb-6 rounded-xl border border-gray-800 bg-[#1a1d23] p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Осталось выучить: {unlearnedCards.length}
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {unlearnedCards.map(c => (
                <span key={c.id} className="rounded-lg bg-[#0f1115] px-2.5 py-1 text-xs text-[#8b90a0]">
                  <span className="text-[#e6e8ec]">{c.word}</span> — {c.translation}
                </span>
              ))}
            </div>
          </details>
        )}

        {cards.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-12 text-center text-[#8b90a0]">
            {isLearnedFolder ? 'У вас пока нет выученных слов.' : 'В этой папке пока нет карточек.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map(card => (
              <div key={card.id} className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold">{card.word}</span>
                      {card.learned_at && (
                        <span className="text-[10px] text-[#8b90a0] bg-[#0f1115] px-1.5 py-0.5 rounded">выучено</span>
                      )}
                      {card.sync_group_id && (
                        <span className="text-[10px] text-[#6c7cff] bg-[#6c7cff]/10 px-1.5 py-0.5 rounded" title="Связано с другими копиями">🔗</span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleFav(card)}
                      className={`text-lg transition ${card.is_favorite ? 'text-[#6c7cff]' : 'text-gray-600 hover:text-gray-400'}`}
                      title="Избранное"
                    >
                      ★
                    </button>
                  </div>
                  {card.transcription && (
                    <p className="text-sm text-[#8b90a0] mb-2">{card.transcription}</p>
                  )}
                  <p className="text-md font-medium mb-3">{card.translation}</p>
                  {card.sentences && card.sentences.length > 0 && (
                    <div className="mb-3 space-y-1 bg-[#0f1115] p-2.5 rounded-lg text-xs text-[#8b90a0]">
                      {card.sentences.map((s, i) => <p key={i}>• {s}</p>)}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-[#8b90a0] pt-3 border-t border-gray-800/50">
                  <span>SRS: {card.srs_level} | Ошибок: {card.wrong_count}</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleOpenEdit(card)} className="text-[#6c7cff] hover:underline">Изм.</button>
                    <button onClick={() => removeCard(card)} className="text-[#a04a4a] hover:opacity-80">Удалить</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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