'use client'

import { useState } from 'react'
import { Card } from '@/types/database'
import { GeneralProgress } from '@/types/general'
import { REINSERT_OFFSETS, wordKey } from '@/lib/general'
import { saveGeneralAnswer, setFavorite } from '@/lib/offline/repo'
import Icon from '@/components/ui/Icon'

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
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in p-6 text-center sm:p-8">
          <h2 className="text-xl">
            {totalCards === 0 ? 'Сейчас нет слов для тренировки' : 'Тренировка завершена'}
          </h2>
          {totalCards > 0 && (
            <>
              <p className="mt-5 text-5xl font-bold leading-none text-[#8ea2ff]">{doneCount}</p>
              <p className="mt-2 text-sm text-[#8a8a96]">карточек обработано</p>
            </>
          )}
          <button onClick={onExit} className="btn btn-primary btn-lg btn-block mt-7">
            Готово
          </button>
        </div>
      </div>
    )
  }

  const progressPercent =
    totalCards > 0 ? Math.min(100, Math.round((doneCount / totalCards) * 100)) : 0

  return (
    <div className={`${SCREEN} pb-4`}>
      <header className="pt-2">
        <div className="flex items-center justify-between gap-3">
          <button onClick={onExit} className="btn btn-ghost btn-sm -ml-3">
            <Icon name="arrowLeft" size={16} />
            Выйти
          </button>
          <span className="text-sm font-medium tabular-nums text-[#b0b0bb]">
            {doneCount} из {totalCards}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#1b1b21]">
          <div
            className="h-full rounded-full bg-[#8ea2ff] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </header>

      {saveError && (
        <div className="mt-4 rounded-xl border border-[#e5786f]/35 bg-[#e5786f]/10 px-4 py-3 text-center text-sm text-[#e5786f]">
          {saveError}
        </div>
      )}

      <main className="flex flex-1 flex-col justify-center py-6">
        <p className="mb-3 text-center text-sm text-[#8a8a96]">
          {showAnswer
            ? 'Отметьте честно: знали вы это слово или нет'
            : 'Вспомните перевод, затем откройте карточку'}
        </p>

        <div
          onClick={() => !showAnswer && setShowAnswer(true)}
          className={`card flex min-h-[340px] select-none flex-col p-5 sm:p-7 ${
            showAnswer ? '' : 'cursor-pointer card-link'
          }`}
        >
          <div className="flex items-start justify-between">
            <button
              onClick={handleSpeak}
              className="icon-btn text-[#8ea2ff]!"
              title="Озвучить"
              aria-label="Озвучить"
            >
              <SpeakerIcon />
            </button>
            <button
              onClick={handleToggleFavorite}
              className={`icon-btn ${currentCard.is_favorite ? 'text-[#8ea2ff]!' : ''}`}
              title="Избранное"
              aria-label="Избранное"
              aria-pressed={!!currentCard.is_favorite}
            >
              <Icon
                name="star"
                size={20}
                className={currentCard.is_favorite ? 'fill-current' : undefined}
              />
            </button>
          </div>

          <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
            <h2 className="break-words text-3xl font-bold sm:text-4xl">{currentCard.word}</h2>
            {currentCard.transcription && (
              <p className="mt-2 text-base text-[#8a8a96]">{currentCard.transcription}</p>
            )}
            <div className="mt-5 flex min-h-[2.5rem] items-center justify-center">
              {showAnswer ? (
                <p className="text-2xl font-semibold text-[#8ea2ff]">{currentCard.translation}</p>
              ) : (
                <p className="text-sm text-[#6b6b76]">Нажмите, чтобы увидеть перевод</p>
              )}
            </div>
          </div>

          {currentCard.sentences && currentCard.sentences.length > 0 && (
            <div className="space-y-2 rounded-xl bg-[#1b1b21] p-4 text-sm leading-relaxed text-[#b0b0bb]">
              {currentCard.sentences.map((s, i) => <p key={i}>{s}</p>)}
            </div>
          )}
        </div>
      </main>

      <footer className="min-h-[3.25rem]">
        {showAnswer ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleDontKnow}
              disabled={isSaving}
              className="btn btn-lg btn-danger"
            >
              {isSaving ? 'Сохраняем…' : 'Не знаю'}
            </button>
            <button
              onClick={handleKnow}
              disabled={isSaving}
              className="btn btn-lg btn-primary"
            >
              {isSaving ? 'Сохраняем…' : 'Знаю'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAnswer(true)}
            className="btn btn-lg btn-block btn-secondary"
          >
            Показать перевод
          </button>
        )}
      </footer>
    </div>
  )
}

const SCREEN =
  'mx-auto flex w-full max-w-xl flex-col px-4 min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]'

function SpeakerIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}