'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card } from '@/types/database'
import { saveCardAnswer, setFavorite } from '@/lib/offline/repo'
import {
  BOT_REPEAT_MISTAKE_THRESHOLD,
  SRS_INTERVALS_DAYS,
  STUDY_REINSERT_OFFSETS,
  queueBotRepeat,
  shuffle,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { clearSession, loadSession, restoreQueue, saveSession } from '@/lib/session'
import Icon from '@/components/ui/Icon'

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
  const [botNotice, setBotNotice] = useState<string | null>(null)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>(
    restored ? restored.saved.wrong : {}
  )
  const [isFinished, setIsFinished] = useState(initialCards.length === 0)

  // Слова, которые уже получили повторную проверку после «Знаю» в этой сессии
  const knownRef = useRef<Set<string>>(new Set(restored ? restored.saved.known : []))
  // Слова, которые уже отправили в обычные повторы бота
  const botQueuedRef = useRef<Set<string>>(new Set())

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

  useEffect(() => {
    if (!botNotice) return
    const timer = setTimeout(() => setBotNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [botNotice])

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
    const ok = await setFavorite(id, newFav)
    if (!ok) {
      setSaveError('Не удалось изменить избранное. Попробуйте ещё раз.')
      return
    }
    setQueue(q => q.map(c => (c.id === id ? { ...c, is_favorite: newFav } : c)))
  }

  const saveAnswer = async (correct: boolean): Promise<boolean> => {
    if (!currentCard) return false
    setIsSaving(true)
    setSaveError(null)
    const ok = await saveCardAnswer(currentCard, correct, isLevel)
    setIsSaving(false)
    if (!ok) {
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

    const ok = await saveAnswer(true)
    if (!ok) return

    const updated = { ...currentCard, ...patch } as Card
    const rest = queue.slice(1)
    const id = currentCard.id
    const hadMistakes = (wrongSession[id] || 0) > 0

    // Первое «Знаю» без ошибок: слово вернётся ещё раз в конце круга.
    // Так следующие слова папки идут подряд, а не перемешиваются с повтором.
    if (
      mode !== 'learned' &&
      !knownRef.current.has(id) &&
      !hadMistakes &&
      rest.length > 0
    ) {
      knownRef.current.add(id)
      setQueue([...rest, updated])
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

    const ok = await saveAnswer(false)
    if (!ok) return

    const id = currentCard.id
    const wrongNow = (wrongSession[id] || 0) + 1
    setWrongSession(prev => ({ ...prev, [id]: wrongNow }))

    const updated = { ...currentCard, ...patch } as Card
    const rest = queue.slice(1).filter(c => c.id !== id)

    // Если слово не даётся много раз — убираем его из этой тренировки
    // и ставим в обычные запланированные повторы бота.
    const tooManyMistakes =
      wrongNow >= BOT_REPEAT_MISTAKE_THRESHOLD || wrongCount >= BOT_REPEAT_MISTAKE_THRESHOLD
    if (tooManyMistakes && !botQueuedRef.current.has(id)) {
      botQueuedRef.current.add(id)
      setIsSaving(true)
      const queued = await queueBotRepeat(id)
      setIsSaving(false)
      if (queued) {
        setBotNotice(`Слово «${currentCard.word}» ушло в обычные повторы бота`)
        completeWord(rest)
        return
      }
      botQueuedRef.current.delete(id)
    }

    if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
      // Возвращаем слово в конец текущего круга, не сдвигая следующие слова папки
      setQueue([...rest, updated])
      setShowAnswer(false)
      return
    }

    completeWord(rest)
  }

  if (isFinished || !currentCard) {
    return (
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in p-6 text-center sm:p-8">
          <h2 className="text-xl">Тренировка завершена</h2>
          <p className="mt-5 text-5xl font-bold leading-none text-[#8ea2ff]">{doneCount}</p>
          <p className="mt-2 text-sm text-[#8a8a96]">слов пройдено</p>
          {botNotice && (
            <p className="mt-5 rounded-xl bg-[#7fc8a0]/10 px-4 py-3 text-sm text-[#7fc8a0]">
              {botNotice}
            </p>
          )}
          <button onClick={handleExit} className="btn btn-primary btn-lg btn-block mt-7">
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
          <button onClick={handleExit} className="btn btn-ghost btn-sm -ml-3">
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
      {botNotice && (
        <div className="mt-4 rounded-xl bg-[#7fc8a0]/10 px-4 py-3 text-center text-sm text-[#7fc8a0]">
          {botNotice}
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

