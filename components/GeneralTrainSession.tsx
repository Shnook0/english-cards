'use client'

import { useState } from 'react'
import { Card } from '@/types/database'
import { GeneralProgress } from '@/types/general'
import { REINSERT_OFFSETS, wordKey } from '@/lib/general'
import { saveGeneralAnswer, setFavorite } from '@/lib/offline/repo'

type Props = {
  trainingId: string
  userId: string
  initialCards: Card[]
  initialProgress: Record<string, GeneralProgress>
  onExit: () => void
}

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
    const ok = await setFavorite(id, newFav)
    if (!ok) {
      setSaveError('Не удалось изменить избранное. Попробуйте ещё раз.')
      return
    }
    setQueue(q => q.map(c => (c.id === id ? { ...c, is_favorite: newFav } : c)))
  }

  const saveAnswer = async (correct: boolean): Promise<GeneralProgress | null> => {
    if (!currentCard) return null
    setIsSaving(true)
    setSaveError(null)
    const saved = await saveGeneralAnswer(
      trainingId,
      currentCard,
      progress[wordKey(currentCard)],
      correct,
      userId
    )
    setIsSaving(false)
    if (!saved) {
      setSaveError('Не удалось сохранить. Проверьте интернет и нажмите ещё раз.')
      return null
    }
    setProgress(prev => ({ ...prev, [saved.word_key]: saved }))
    return saved
  }

  const handleKnow = async () => {
    if (!currentCard || isSaving) return

    const saved = await saveAnswer(true)
    if (!saved) return

    const rest = queue.slice(1)
    setDoneCount(d => d + 1)
    setShowAnswer(false)
    setQueue(rest)
    if (rest.length === 0) setIsFinished(true)
  }

  const handleDontKnow = async () => {
    if (!currentCard || isSaving) return

    const saved = await saveAnswer(false)
    if (!saved) return

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
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24242b] bg-[#15151a] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {totalCards === 0 ? 'Сейчас нет слов для тренировки' : 'Сессия завершена'}
          </h2>
          {totalCards > 0 && (
            <p className="text-sm text-[#8a8a96] mb-6">Обработано карточек: {doneCount}</p>
          )}
          {totalCards === 0 && <div className="mb-6" />}
          <button
            onClick={onExit}
            className="w-full rounded-lg bg-[#8ea2ff] py-3 font-medium text-[#0d0d10] hover:bg-[#7186e8] transition"
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
    <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] p-4 md:p-8 flex flex-col justify-between max-w-2xl mx-auto">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#e5786f]/20 border border-[#e5786f] p-3 text-sm text-center">
          {saveError}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3 text-sm text-[#8a8a96]">
          <span>{doneCount} / {totalCards}</span>
          <button onClick={onExit} className="hover:text-[#ececf1] transition font-medium">
            Выйти
          </button>
        </div>
        <div className="w-full h-1.5 bg-[#1b1b21] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#8ea2ff] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div
        onClick={() => !showAnswer && setShowAnswer(true)}
        className="my-auto cursor-pointer min-h-[360px] rounded-2xl border border-[#24242b] bg-[#15151a] p-6 md:p-8 shadow-2xl flex flex-col justify-between transition hover:border-[#2c2c34] select-none"
      >
        <div className="flex justify-between items-start">
          <button
            onClick={handleSpeak}
            className="p-2 rounded-lg bg-[#0d0d10] text-[#8ea2ff] hover:bg-[#1b1b21] transition"
            title="Озвучить"
          >
            🔊
          </button>
          <button
            onClick={handleToggleFavorite}
            className={`text-xl transition ${currentCard.is_favorite ? 'text-[#8ea2ff]' : 'text-[#4c4c57] hover:text-[#8a8a96]'}`}
            title="Избранное"
          >
            ★
          </button>
        </div>

        <div className="text-center my-4">
          <h2 className="text-3xl md:text-4xl font-bold mb-2">{currentCard.word}</h2>
          {currentCard.transcription && (
            <p className="text-sm text-[#8a8a96]">{currentCard.transcription}</p>
          )}
        </div>

        {currentCard.sentences && currentCard.sentences.length > 0 && (
          <div className="space-y-1.5 bg-[#0d0d10] p-3 rounded-xl text-xs text-[#8a8a96] mb-4">
            {currentCard.sentences.map((s, i) => <p key={i}>• {s}</p>)}
          </div>
        )}

        {showAnswer ? (
          <div className="pt-4 border-t border-[#24242b] text-center">
            <p className="text-2xl font-bold text-[#8ea2ff]">{currentCard.translation}</p>
          </div>
        ) : (
          <div className="text-center text-xs text-[#8a8a96] pt-2 border-t border-[#24242b]/50 tracking-wider">
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
              className="rounded-xl border border-[#e5786f] bg-[#e5786f]/10 py-3.5 font-semibold text-[#e5786f] hover:bg-[#e5786f]/20 transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Не знаю'}
            </button>
            <button
              onClick={handleKnow}
              disabled={isSaving}
              className="rounded-xl bg-[#8ea2ff] py-3.5 font-semibold text-[#0d0d10] hover:bg-[#7186e8] transition disabled:opacity-50"
            >
              {isSaving ? 'Сохранение...' : 'Знаю'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAnswer(true)}
            className="w-full rounded-xl border border-[#2c2c34] bg-[#15151a] py-3.5 font-semibold text-[#ececf1] hover:border-[#8ea2ff] transition"
          >
            Показать ответ
          </button>
        )}
      </div>
    </div>
  )
}