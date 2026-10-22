'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card } from '@/types/database'
import {
  STUDY_REINSERT_OFFSETS,
  StudyGameProps,
  insertAt,
  isSpellingCorrect,
  knowRecheckOffset,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { clearSession, loadSession, restoreQueue, saveSession } from '@/lib/session'

type Status = 'typing' | 'wrongOnce' | 'correct' | 'revealed'

export default function DictationGame({ cards, recordResult, onNextRound, onExit }: StudyGameProps) {
  warmUpVoices()

  const pathname = usePathname()
  const sessionKey = `dictation:${pathname}`

  // Если вернулись к незаконченному диктанту (до 20 минут назад), продолжаем с того же места
  const [restored] = useState(() => {
    const saved = loadSession(sessionKey)
    const q = restoreQueue(saved, cards)
    return saved && q ? { saved, queue: q } : null
  })

  const [queue, setQueue] = useState<Card[]>(restored ? restored.queue : cards)
  const [totalCards] = useState(restored ? restored.saved.total : cards.length)
  const [doneCount, setDoneCount] = useState(restored ? restored.saved.done : 0)
  const [input, setInput] = useState('')
  const [attempt, setAttempt] = useState(1)
  const [status, setStatus] = useState<Status>('typing')
  const [showHint, setShowHint] = useState(false)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>(
    restored ? restored.saved.wrong : {}
  )
  const [firstTryCount, setFirstTryCount] = useState(restored?.saved.firstTry ?? 0)
  const [failedCount, setFailedCount] = useState(restored?.saved.failed ?? 0)
  const [turn, setTurn] = useState(0)
  const [isFinished, setIsFinished] = useState(cards.length === 0)
  const [saveError, setSaveError] = useState(false)

  // Слова, которые уже получили повторную проверку после верного ответа в этой сессии
  const knownRef = useRef<Set<string>>(new Set(restored ? restored.saved.known : []))
  const inputRef = useRef<HTMLInputElement>(null)
  const current = queue[0]

  // Запоминаем ход диктанта (или стираем, если он закончен)
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
      firstTry: firstTryCount,
      failed: failedCount,
    })
  }, [queue, doneCount, wrongSession, firstTryCount, failedCount, isFinished, sessionKey, totalCards])

  const handleExit = () => {
    clearSession(sessionKey)
    onExit()
  }

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

  // После верного ответа: первый раз слово вернётся через 7–10 слов, второй раз слово пройдено
  const advanceAfterCorrect = () => {
    if (!current) return
    const rest = queue.slice(1)
    let newQ = rest

    if (!knownRef.current.has(current.id) && rest.length > 0) {
      knownRef.current.add(current.id)
      newQ = insertAt(rest, current, knowRecheckOffset())
    } else {
      knownRef.current.add(current.id)
      setDoneCount(d => d + 1)
    }

    resetCardState()
    setQueue(newQ)
    setTurn(t => t + 1)
    if (newQ.length === 0) setIsFinished(true)
  }

  // Верный ответ: показываем «Верно!» и через короткую паузу идём дальше
  useEffect(() => {
    if (status !== 'correct') return
    const id = setTimeout(advanceAfterCorrect, 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const goNextAfterFail = () => {
    if (!current) return
    const key = current.id
    const wrongNow = (wrongSession[key] || 0) + 1
    setWrongSession(prev => ({ ...prev, [key]: wrongNow }))

    const rest = queue.slice(1)
    let newQ = rest
    if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
      // Слово вернётся через 2 / 5 / 10 / 15 слов
      newQ = insertAt(rest, current, STUDY_REINSERT_OFFSETS[wrongNow - 1])
    } else {
      setDoneCount(d => d + 1)
    }

    resetCardState()
    setQueue(newQ)
    setTurn(t => t + 1)
    if (newQ.length === 0) setIsFinished(true)
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
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24221e] bg-[#111110] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {totalCards === 0 ? 'Нет слов для диктанта' : 'Сессия завершена'}
          </h2>
          {totalCards > 0 && (
            <p className="text-sm text-[#948e82] mb-6">
              С первой попытки: {firstTryCount} · Ошибок: {failedCount}
            </p>
          )}
          {totalCards === 0 && <div className="mb-6" />}
          <div className="flex flex-col gap-3">
            {totalCards > 0 && (
              <button
                onClick={onNextRound}
                className="w-full rounded-lg bg-[#c9a96e] py-3 font-medium text-[#0b0b0a] hover:bg-[#b8975b] transition"
              >
                Ещё раунд
              </button>
            )}
            <button
              onClick={handleExit}
              className="w-full rounded-lg border border-[#2d2a25] py-3 font-medium hover:border-[#c9a96e] transition"
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
    <div className="min-h-screen bg-[#090909] text-[#f2eee5] p-4 md:p-8 max-w-2xl mx-auto flex flex-col">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#bb7464]/20 border border-[#bb7464] p-3 text-sm text-center">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3 text-sm text-[#948e82]">
          <span>Диктант · {doneCount} / {totalCards}</span>
          <button onClick={handleExit} className="hover:text-[#f2eee5] transition font-medium">
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

      <div className="rounded-2xl border border-[#24221e] bg-[#111110] p-6 md:p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => speak(current.word)}
            className="rounded-xl bg-[#090909] px-6 py-4 text-3xl text-[#c9a96e] hover:bg-[#1b1a17] transition"
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
            className={`w-full rounded-lg border bg-[#090909] p-3 text-center text-lg text-[#f2eee5] outline-none disabled:opacity-70 ${
              status === 'correct'
                ? 'border-[#6f8a72]'
                : status === 'wrongOnce' || status === 'revealed'
                ? 'border-[#bb7464]'
                : 'border-[#2d2a25] focus:border-[#c9a96e]'
            }`}
          />

          {status === 'wrongOnce' && (
            <p className="text-center text-sm text-[#bb7464]">Неверно. Попробуйте ещё раз.</p>
          )}
          {status === 'correct' && (
            <p className="text-center text-sm text-[#9fb59f]">Верно!</p>
          )}

          {status === 'revealed' && (
            <div className="rounded-xl bg-[#090909] p-4 text-center">
              <p className="text-sm text-[#948e82] mb-1">Правильно:</p>
              <p className="text-2xl font-bold text-[#c9a96e]">{current.word}</p>
              {current.transcription && (
                <p className="text-sm text-[#948e82] mt-1">{current.transcription}</p>
              )}
              <p className="text-md mt-2">{current.translation}</p>
            </div>
          )}

          {showHint && status !== 'revealed' && (
            <p className="text-center text-sm text-[#948e82]">Перевод: {current.translation}</p>
          )}

          <div className="flex gap-3">
            {status !== 'revealed' && status !== 'correct' && (
              <button
                type="button"
                onClick={() => setShowHint(true)}
                className="rounded-xl border border-[#2d2a25] px-4 py-3 text-sm font-medium hover:border-[#c9a96e] transition"
              >
                Подсказка
              </button>
            )}
            {status === 'revealed' ? (
              <button
                key="next"
                type="submit"
                autoFocus
                className="flex-1 rounded-xl bg-[#c9a96e] py-3 font-semibold text-[#0b0b0a] hover:bg-[#b8975b] transition"
              >
                Дальше
              </button>
            ) : (
              <button
                key="check"
                type="submit"
                disabled={status === 'correct' || !input.trim()}
                className="flex-1 rounded-xl bg-[#c9a96e] py-3 font-semibold text-[#0b0b0a] hover:bg-[#b8975b] transition disabled:opacity-50"
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

// конец файла