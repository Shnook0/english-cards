'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/types/database'
import {
  STUDY_REINSERT_OFFSETS,
  StudyGameProps,
  isSpellingCorrect,
  speak,
  warmUpVoices,
} from '@/lib/study'

type Status = 'typing' | 'wrongOnce' | 'correct' | 'revealed'

export default function DictationGame({ cards, recordResult, onNextRound, onExit }: StudyGameProps) {
  warmUpVoices()

  const [queue, setQueue] = useState<Card[]>(cards)
  const [totalCards] = useState(cards.length)
  const [doneCount, setDoneCount] = useState(0)
  const [input, setInput] = useState('')
  const [attempt, setAttempt] = useState(1)
  const [status, setStatus] = useState<Status>('typing')
  const [showHint, setShowHint] = useState(false)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>({})
  const [firstTryCount, setFirstTryCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [turn, setTurn] = useState(0)
  const [isFinished, setIsFinished] = useState(cards.length === 0)
  const [saveError, setSaveError] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const current = queue[0]

  // Озвучиваем слово при каждой новой карточке
  useEffect(() => {
    if (current) speak(current.word)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn])

  useEffect(() => {
    if (status === 'typing' || status === 'wrongOnce') inputRef.current?.focus()
  }, [turn, status])

  const report = (card: Card, correct: boolean) => {
    recordResult(card, correct).then(ok => {
      if (!ok) setSaveError(true)
    })
  }

  const resetCardState = () => {
    setInput('')
    setAttempt(1)
    setStatus('typing')
    setShowHint(false)
  }

  const goNextCompleted = () => {
    const rest = queue.slice(1)
    resetCardState()
    setDoneCount(d => d + 1)
    setQueue(rest)
    setTurn(t => t + 1)
    if (rest.length === 0) setIsFinished(true)
  }

  // Верный ответ: показываем «Верно!» и через короткую паузу идём дальше
  useEffect(() => {
    if (status !== 'correct') return
    const id = setTimeout(goNextCompleted, 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const goNextAfterFail = () => {
    if (!current) return
    const key = current.id
    const wrongNow = (wrongSession[key] || 0) + 1
    setWrongSession(prev => ({ ...prev, [key]: wrongNow }))

    const rest = queue.slice(1)
    if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
      // Слово вернётся через 2 / 10 / 15 карточек
      const at = Math.min(STUDY_REINSERT_OFFSETS[wrongNow - 1], rest.length)
      const newQ = [...rest]
      newQ.splice(at, 0, current)
      setQueue(newQ)
    } else {
      setDoneCount(d => d + 1)
      setQueue(rest)
      if (rest.length === 0) setIsFinished(true)
    }

    resetCardState()
    setTurn(t => t + 1)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!current) return

    if (status === 'revealed') {
      goNextAfterFail()
      return
    }
    if (status === 'correct') return

    const value = input.trim()
    if (!value) return

    if (isSpellingCorrect(value, current.word)) {
      if (attempt === 1) {
        report(current, true)
        setFirstTryCount(n => n + 1)
      }
      setStatus('correct')
      return
    }

    if (attempt === 1) {
      setAttempt(2)
      setStatus('wrongOnce')
      setInput('')
      return
    }

    // Вторая неверная попытка: ошибка + показываем правильный ответ
    report(current, false)
    setFailedCount(n => n + 1)
    setStatus('revealed')
  }

  if (isFinished || !current) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-[#1a1d23] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {totalCards === 0 ? 'Нет слов для диктанта' : 'Сессия завершена'}
          </h2>
          {totalCards > 0 && (
            <p className="text-sm text-[#8b90a0] mb-6">
              С первой попытки: {firstTryCount} · Ошибок: {failedCount}
            </p>
          )}
          {totalCards === 0 && <div className="mb-6" />}
          <div className="flex flex-col gap-3">
            {totalCards > 0 && (
              <button
                onClick={onNextRound}
                className="w-full rounded-lg bg-[#6c7cff] py-3 font-medium text-white hover:bg-[#5865e0] transition"
              >
                Ещё раунд
              </button>
            )}
            <button
              onClick={onExit}
              className="w-full rounded-lg border border-gray-700 py-3 font-medium hover:border-[#6c7cff] transition"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  const progressPercent =
    totalCards > 0 ? Math.min(100, Math.round((doneCount / totalCards) * 100)) : 0

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-4 md:p-8 max-w-2xl mx-auto flex flex-col">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm text-center">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3 text-sm text-[#8b90a0]">
          <span>Диктант · {doneCount} / {totalCards}</span>
          <button onClick={onExit} className="hover:text-[#e6e8ec] transition font-medium">
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

      <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 md:p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => speak(current.word)}
            className="rounded-xl bg-[#0f1115] px-6 py-4 text-3xl text-[#6c7cff] hover:bg-gray-800 transition"
            title="Прослушать ещё раз"
          >
            🔊
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={status === 'correct' || status === 'revealed'}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="Введите слово по-английски"
            className={`w-full rounded-lg border bg-[#0f1115] p-3 text-center text-lg text-[#e6e8ec] outline-none disabled:opacity-70 ${
              status === 'correct'
                ? 'border-green-500'
                : status === 'wrongOnce' || status === 'revealed'
                ? 'border-[#a04a4a]'
                : 'border-gray-700 focus:border-[#6c7cff]'
            }`}
          />

          {status === 'wrongOnce' && (
            <p className="text-center text-sm text-[#a04a4a]">Неверно. Попробуйте ещё раз.</p>
          )}
          {status === 'correct' && (
            <p className="text-center text-sm text-green-400">Верно!</p>
          )}

          {status === 'revealed' && (
            <div className="rounded-xl bg-[#0f1115] p-4 text-center">
              <p className="text-sm text-[#8b90a0] mb-1">Правильно:</p>
              <p className="text-2xl font-bold text-[#6c7cff]">{current.word}</p>
              {current.transcription && (
                <p className="text-sm text-[#8b90a0] mt-1">{current.transcription}</p>
              )}
              <p className="text-md mt-2">{current.translation}</p>
            </div>
          )}

          {showHint && status !== 'revealed' && (
            <p className="text-center text-sm text-[#8b90a0]">Перевод: {current.translation}</p>
          )}

          <div className="flex gap-3">
            {status !== 'revealed' && status !== 'correct' && (
              <button
                type="button"
                onClick={() => setShowHint(true)}
                className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium hover:border-[#6c7cff] transition"
              >
                Подсказка
              </button>
            )}
            {status === 'revealed' ? (
              <button
                key="next"
                type="submit"
                autoFocus
                className="flex-1 rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition"
              >
                Дальше
              </button>
            ) : (
              <button
                key="check"
                type="submit"
                disabled={status === 'correct' || !input.trim()}
                className="flex-1 rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition disabled:opacity-50"
              >
                Проверить
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}