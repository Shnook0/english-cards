'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/types/database'
import { GeneralProgress } from '@/types/general'
import {
  INTERVALS_DAYS,
  MISTAKE_DAYS,
  MISTAKE_STREAK_TO_CLEAR,
  REINSERT_OFFSETS,
  wordKey,
} from '@/lib/general'

type Props = {
  trainingId: string
  userId: string
  initialCards: Card[]
  initialProgress: Record<string, GeneralProgress>
  onExit: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

export default function GeneralTrainSession({
  trainingId,
  userId,
  initialCards,
  initialProgress,
  onExit,
}: Props) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.getVoices()
  }

  const [queue, setQueue] = useState<Card[]>(initialCards)
  const [progress, setProgress] = useState<Record<string, GeneralProgress>>(initialProgress)
  const [totalCards] = useState(initialCards.length)
  const [doneCount, setDoneCount] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>({})
  const [isFinished, setIsFinished] = useState(initialCards.length === 0)

  const currentCard = queue[0]

  const speakWord = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()

    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.9
    u.pitch = 1

    const voices = window.speechSynthesis.getVoices()
    const best =
      voices.find(v => v.name === 'Google US English') ||
      voices.find(v => v.lang === 'en-US' && v.localService === false) ||
      voices.find(v => v.lang === 'en-US') ||
      voices.find(v => v.lang.startsWith('en'))
    if (best) u.voice = best

    window.speechSynthesis.speak(u)
  }

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (currentCard) speakWord(currentCard.word)
  }

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentCard || isSaving) return
    const id = currentCard.id
    const newFav = !currentCard.is_favorite
    await supabase.from('cards').update({ is_favorite: newFav }).eq('id', id)
    setQueue(q => q.map(c => (c.id === id ? { ...c, is_favorite: newFav } : c)))
  }

  const getProgress = (card: Card): GeneralProgress => {
    const key = wordKey(card)
    return (
      progress[key] ?? {
        training_id: trainingId,
        word_key: key,
        user_id: userId,
        level: 0,
        next_review_at: new Date().toISOString(),
        mistake_until: null,
        mistake_streak: 0,
        wrong_total: 0,
        updated_at: new Date().toISOString(),
      }
    )
  }

  const saveProgress = async (row: GeneralProgress): Promise<boolean> => {
    setIsSaving(true)
    setSaveError(null)
    const { error } = await supabase
      .from('general_progress')
      .upsert(row, { onConflict: 'training_id,word_key' })
    setIsSaving(false)
    if (error) {
      setSaveError('Не удалось сохранить. Проверьте интернет и нажмите ещё раз.')
      return false
    }
    setProgress(prev => ({ ...prev, [row.word_key]: row }))
    return true
  }

  const handleKnow = async () => {
    if (!currentCard || isSaving) return

    const p = getProgress(currentCard)
    const now = Date.now()
    const lastIdx = INTERVALS_DAYS.length - 1
    const days = INTERVALS_DAYS[Math.min(p.level, lastIdx)]

    let mistakeUntil: string | null = p.mistake_until
    let streak = p.mistake_streak
    if (mistakeUntil && new Date(mistakeUntil).getTime() > now) {
      streak += 1
      if (streak >= MISTAKE_STREAK_TO_CLEAR) {
        mistakeUntil = null
        streak = 0
      }
    } else {
      mistakeUntil = null
      streak = 0
    }

    const row: GeneralProgress = {
      ...p,
      level: Math.min(p.level + 1, lastIdx),
      next_review_at: new Date(now + days * DAY_MS).toISOString(),
      mistake_until: mistakeUntil,
      mistake_streak: streak,
      updated_at: new Date(now).toISOString(),
    }

    const ok = await saveProgress(row)
    if (!ok) return

    const rest = queue.slice(1)
    setDoneCount(d => d + 1)
    setShowAnswer(false)
    setQueue(rest)
    if (rest.length === 0) setIsFinished(true)
  }

  const handleDontKnow = async () => {
    if (!currentCard || isSaving) return

    const p = getProgress(currentCard)
    const now = Date.now()

    const row: GeneralProgress = {
      ...p,
      level: Math.max(p.level - 2, 0),
      next_review_at: new Date(now + INTERVALS_DAYS[0] * DAY_MS).toISOString(),
      mistake_until: new Date(now + MISTAKE_DAYS * DAY_MS).toISOString(),
      mistake_streak: 0,
      wrong_total: p.wrong_total + 1,
      updated_at: new Date(now).toISOString(),
    }

    const ok = await saveProgress(row)
    if (!ok) return

    const key = wordKey(currentCard)
    const wrongNow = (wrongSession[key] || 0) + 1
    setWrongSession(prev => ({ ...prev, [key]: wrongNow }))

    const rest = queue.slice(1)
    setShowAnswer(false)

    if (wrongNow <= REINSERT_OFFSETS.length) {
      // Слово вернётся через 2 / 10 / 15 карточек (в зависимости от того, какой это раз)
      const at = Math.min(REINSERT_OFFSETS[wrongNow - 1], rest.length)
      const newQ = [...rest]
      newQ.splice(at, 0, currentCard)
      setQueue(newQ)
    } else {
      setDoneCount(d => d + 1)
      setQueue(rest)
      if (rest.length === 0) setIsFinished(true)
    }
  }

  if (isFinished || !currentCard) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24221e] bg-[#111110] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {totalCards === 0 ? 'Сейчас нет слов для тренировки' : 'Сессия завершена'}
          </h2>
          {totalCards > 0 && (
            <p className="text-sm text-[#948e82] mb-6">Обработано карточек: {doneCount}</p>
          )}
          {totalCards === 0 && <div className="mb-6" />}
          <button
            onClick={onExit}
            className="w-full rounded-lg bg-[#c9a96e] py-3 font-medium text-[#0b0b0a] hover:bg-[#b8975b] transition"
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
    <div className="min-h-screen bg-[#090909] text-[#f2eee5] p-4 md:p-8 flex flex-col justify-between max-w-2xl mx-auto">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#bb7464]/20 border border-[#bb7464] p-3 text-sm text-center">
          {saveError}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3 text-sm text-[#948e82]">
          <span>{doneCount} / {totalCards}</span>
          <button onClick={onExit} className="hover:text-[#f2eee5] transition font-medium">
            Выйти
          </button>
        </div>
        <div className="w-full h-1.5 bg-[#1b1a17] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#c9a96e] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div
        onClick={() => !showAnswer && setShowAnswer(true)}
        className="my-auto cursor-pointer min-h-[360px] rounded-2xl border border-[#24221e] bg-[#111110] p-6 md:p-8 shadow-2xl flex flex-col justify-between transition hover:border-[#2d2a25] select-none"
      >
        <div className="flex justify-between items-start">
          <button
            onClick={handleSpeak}
            className="p-2 rounded-lg bg-[#090909] text-[#c9a96e] hover:bg-[#1b1a17] transition"
            title="Озвучить"
          >
            🔊
          </button>
          <button
            onClick={handleToggleFavorite}
            className={`text-xl transition ${currentCard.is_favorite ? 'text-[#c9a96e]' : 'text-[#514c44] hover:text-[#948e82]'}`}
            title="Избранное"
          >
            ★
          </button>
        </div>

        <div className="text-center my-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-2">{currentCard.word}</h2>
          {currentCard.transcription && (
            <p className="text-sm text-[#948e82]">{currentCard.transcription}</p>
          )}
        </div>

        {currentCard.sentences && currentCard.sentences.length > 0 && (
          <div className="space-y-1.5 bg-[#090909] p-3 rounded-xl text-xs text-[#948e82] mb-4">
            {currentCard.sentences.map((s, i) => <p key={i}>• {s}</p>)}
          </div>
        )}

        {showAnswer ? (
          <div className="pt-4 border-t border-[#24221e] text-center">
            <p className="text-2xl font-bold text-[#c9a96e]">{currentCard.translation}</p>
          </div>
        ) : (
          <div className="text-center text-xs text-[#948e82] pt-2 border-t border-[#24221e]/50 uppercase tracking-wider">
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
              className="rounded-xl border border-[#bb7464] bg-[#bb7464]/10 py-3.5 font-semibold text-[#bb7464] hover:bg-[#bb7464]/20 transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Не знаю'}
            </button>
            <button
              onClick={handleKnow}
              disabled={isSaving}
              className="rounded-xl bg-[#c9a96e] py-3.5 font-semibold text-[#0b0b0a] hover:bg-[#b8975b] transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Знаю'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAnswer(true)}
            className="w-full rounded-xl border border-[#2d2a25] bg-[#111110] py-3.5 font-semibold text-[#f2eee5] hover:border-[#c9a96e] transition"
          >
            Показать ответ
          </button>
        )}
      </div>
    </div>
  )
}