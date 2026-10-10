'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Card } from '@/types/database'
import {
  SRS_INTERVALS_DAYS,
  STUDY_REINSERT_OFFSETS,
  insertAt,
  knowRecheckOffset,
  shuffle,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { clearSession, loadSession, restoreQueue, saveSession } from '@/lib/session'

type Mode = 'folder' | 'learned' | 'favorites' | 'mistakes' | 'level'

type Props = {
  initialCards: Card[]
  mode: Mode
  userId: string
  learnedFolderId: string | null
  onExit: () => void
}

export default function TrainSession({ initialCards, mode, onExit }: Props) {
  warmUpVoices()

  const pathname = usePathname()
  const sessionKey = `train:${pathname}`
  const isLevel = mode === 'level'

  // Если вернулись к незаконченной тренировке (до 20 минут назад), продолжаем с того же места
  const [restored] = useState(() => {
    const saved = loadSession(sessionKey)
    const q = restoreQueue(saved, initialCards)
    return saved && q ? { saved, queue: q } : null
  })

  // Для обычных папок и уровней порядок слов приходит готовым (ошибки → новые → остальные),
  // для «Избранного», «Частых ошибок» и «Выученных» слова перемешиваются
  const [queue, setQueue] = useState<Card[]>(() =>
    restored
      ? restored.queue
      : isLevel || mode === 'folder'
      ? initialCards
      : shuffle(initialCards)
  )
  const [totalCards] = useState(restored ? restored.saved.total : initialCards.length)
  const [doneCount, setDoneCount] = useState(restored ? restored.saved.done : 0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>(
    restored ? restored.saved.wrong : {}
  )
  const [isFinished, setIsFinished] = useState(initialCards.length === 0)

  // Слова, которые уже получили повторную проверку после «Знаю» в этой сессии
  const knownRef = useRef<Set<string>>(new Set(restored ? restored.saved.known : []))

  const currentCard = queue[0]

  // Запоминаем ход тренировки (или стираем, если она закончена)
  useEffect(() => {
    if (isFinished) {
      clearSession(sessionKey)
      return
    }
    saveSession(sessionKey, {
      queueIds: queue.map(c => c.id),
      total: totalCards,
      done: doneCount,
      wrong: wrongSession,
      known: Array.from(knownRef.current),
    })
  }, [queue, doneCount, wrongSession, isFinished, sessionKey, totalCards])

  const handleExit = () => {
    clearSession(sessionKey)
    onExit()
  }

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (currentCard) speak(currentCard.word)
  }

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentCard || isSaving) return
    const id = currentCard.id
    const newFav = !currentCard.is_favorite
    await supabase.from('cards').update({ is_favorite: newFav }).eq('id', id)
    setQueue(q => q.map(c => (c.id === id ? { ...c, is_favorite: newFav } : c)))
  }

  const saveCard = async (patch: Partial<Card>): Promise<boolean> => {
    if (!currentCard) return false
    setIsSaving(true)
    setSaveError(null)
    const { error } = await supabase.from('cards').update(patch).eq('id', currentCard.id)
    setIsSaving(false)
    if (error) {
      setSaveError('Не удалось сохранить. Проверьте интернет и нажмите ещё раз.')
      return false
    }
    return true
  }

  // Слово пройдено окончательно: убираем из очереди и считаем
  const completeWord = (rest: Card[]) => {
    setDoneCount(d => d + 1)
    setQueue(rest)
    setShowAnswer(false)
    if (rest.length === 0) setIsFinished(true)
  }

  const handleKnow = async () => {
    if (!currentCard || isSaving) return

    const oldSrs = currentCard.srs_level || 0
    const days = SRS_INTERVALS_DAYS[oldSrs] ?? 240
    const next = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    const newStreak = (currentCard.known_streak || 0) + 1
    const newSrs = Math.min(oldSrs + 1, 7)
    const newWrong = Math.max((currentCard.wrong_count || 0) - 1, 0)

    const patch: Record<string, unknown> = {
      srs_level: newSrs,
      known_streak: newStreak,
      wrong_count: newWrong,
      next_review_at: next,
    }

    // В режиме «уровень»: одно «Знаю» → сразу выучено
    if (isLevel && !currentCard.learned_at) {
      patch.learned_at = new Date().toISOString()
    } else if (
      mode !== 'learned' &&
      mode !== 'level' &&
      newStreak >= 3 &&
      !currentCard.learned_at
    ) {
      patch.learned_at = new Date().toISOString()
    }

    const ok = await saveCard(patch as Partial<Card>)
    if (!ok) return

    const updated = { ...currentCard, ...patch } as Card
    const rest = queue.slice(1)
    const id = currentCard.id

    // Первое «Знаю» в сессии: слово вернётся ещё раз через 7–10 слов
    if (mode !== 'learned' && !knownRef.current.has(id) && rest.length > 0) {
      knownRef.current.add(id)
      setQueue(insertAt(rest, updated, knowRecheckOffset()))
      setShowAnswer(false)
      return
    }

    knownRef.current.add(id)
    completeWord(rest)
  }

  const handleDontKnow = async () => {
    if (!currentCard || isSaving) return

    const wasLearned = !!currentCard.learned_at

    let wrongCount: number
    if (isLevel) {
      // В уровне: сразу минимум 5, чтобы надолго осталось в «Частых ошибках»
      wrongCount = Math.max((currentCard.wrong_count || 0) + 1, 5)
    } else if (wasLearned) {
      wrongCount = Math.max((currentCard.wrong_count || 0) + 1, 2)
    } else {
      wrongCount = (currentCard.wrong_count || 0) + 1
    }

    const patch: Partial<Card> = {
      srs_level: 0,
      known_streak: 0,
      wrong_count: wrongCount,
      next_review_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }
    if (wasLearned) patch.learned_at = null

    const ok = await saveCard(patch)
    if (!ok) return

    const id = currentCard.id
    const wrongNow = (wrongSession[id] || 0) + 1
    setWrongSession(prev => ({ ...prev, [id]: wrongNow }))

    const updated = { ...currentCard, ...patch } as Card
    const rest = queue.slice(1)

    if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
      // Слово вернётся через 2 / 5 / 10 / 15 слов
      setQueue(insertAt(rest, updated, STUDY_REINSERT_OFFSETS[wrongNow - 1]))
      setShowAnswer(false)
      return
    }

    completeWord(rest)
  }

  if (isFinished || !currentCard) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-[#1a1d23] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">Сессия завершена</h2>
          <p className="text-sm text-[#8b90a0] mb-6">Пройдено слов: {doneCount}</p>
          <button
            onClick={handleExit}
            className="w-full rounded-lg bg-[#6c7cff] py-3 font-medium text-white hover:bg-[#5865e0] transition"
          >
            Готово
          </button>
        </div>
      </div>
    )
  }

  const progressPercent =
    totalCards > 0 ? Math.min(100, Math.round((doneCount / totalCards) * 100)) : 0

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-4 md:p-8 flex flex-col justify-between max-w-2xl mx-auto">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm text-center">
          {saveError}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3 text-sm text-[#8b90a0]">
          <span>{doneCount} / {totalCards}</span>
          <button onClick={handleExit} className="hover:text-[#e6e8ec] transition font-medium">
            Выйти
          </button>
        </div>
        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#6c7cff] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div
        onClick={() => !showAnswer && setShowAnswer(true)}
        className="my-auto cursor-pointer min-h-[360px] rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 md:p-8 shadow-2xl flex flex-col justify-between transition hover:border-gray-700 select-none"
      >
        <div className="flex justify-between items-start">
          <button
            onClick={handleSpeak}
            className="p-2 rounded-lg bg-[#0f1115] text-[#6c7cff] hover:bg-gray-800 transition"
            title="Озвучить"
          >
            🔊
          </button>
          <button
            onClick={handleToggleFavorite}
            className={`text-xl transition ${currentCard.is_favorite ? 'text-[#6c7cff]' : 'text-gray-600 hover:text-gray-400'}`}
            title="Избранное"
          >
            ★
          </button>
        </div>

        <div className="text-center my-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-2">{currentCard.word}</h2>
          {currentCard.transcription && (
            <p className="text-sm text-[#8b90a0]">{currentCard.transcription}</p>
          )}
        </div>

        {currentCard.sentences && currentCard.sentences.length > 0 && (
          <div className="space-y-1.5 bg-[#0f1115] p-3 rounded-xl text-xs text-[#8b90a0] mb-4">
            {currentCard.sentences.map((s, i) => <p key={i}>• {s}</p>)}
          </div>
        )}

        {showAnswer ? (
          <div className="pt-4 border-t border-gray-800 text-center">
            <p className="text-2xl font-bold text-[#6c7cff]">{currentCard.translation}</p>
          </div>
        ) : (
          <div className="text-center text-xs text-[#8b90a0] pt-2 border-t border-gray-800/50 uppercase tracking-wider">
            Нажмите, чтобы показать перевод
          </div>
        )}
      </div>

      <div className="py-4">
        {showAnswer ? (
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleDontKnow}
              disabled={isSaving}
              className="rounded-xl border border-[#a04a4a] bg-[#a04a4a]/10 py-3.5 font-semibold text-[#a04a4a] hover:bg-[#a04a4a]/20 transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Не знаю'}
            </button>
            <button
              onClick={handleKnow}
              disabled={isSaving}
              className="rounded-xl bg-[#6c7cff] py-3.5 font-semibold text-white hover:bg-[#5865e0] transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Знаю'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAnswer(true)}
            className="w-full rounded-xl border border-gray-700 bg-[#1a1d23] py-3.5 font-semibold text-[#e6e8ec] hover:border-[#6c7cff] transition"
          >
            Показать ответ
          </button>
        )}
      </div>
    </div>
  )
}

