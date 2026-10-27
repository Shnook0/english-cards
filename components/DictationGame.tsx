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
import Icon from '@/components/ui/Icon'

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
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in p-6 text-center sm:p-8">
          <h2 className="text-xl">
            {totalCards === 0 ? 'Нет слов для диктанта' : 'Диктант завершён'}
          </h2>
          {totalCards > 0 && (
            <>
              <p className="mt-5 text-5xl font-bold leading-none text-[#8ea2ff]">{firstTryCount}</p>
              <p className="mt-2 text-sm text-[#8a8a96]">
                слов с первой попытки · ошибок: {failedCount}
              </p>
            </>
          )}
          <div className="mt-7 flex flex-col gap-3">
            {totalCards > 0 && (
              <button onClick={onNextRound} className="btn btn-primary btn-lg btn-block">
                Ещё раунд
              </button>
            )}
            <button onClick={handleExit} className="btn btn-secondary btn-lg btn-block">
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
    <div className={`${SCREEN} pb-4`}>
      <header className="pt-2">
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExit} className="btn btn-ghost btn-sm -ml-3">
            <Icon name="arrowLeft" size={16} />
            Выйти
          </button>
          <span className="text-sm font-medium tabular-nums text-[#b0b0bb]">
            Диктант · {doneCount} из {totalCards}
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
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col py-6">
        <p className="mb-3 text-center text-sm text-[#8a8a96]">
          Послушайте слово и напишите его по-английски
        </p>

        <div className="card flex flex-col items-center p-6 text-center sm:p-8">
          <button
            type="button"
            onClick={() => speak(current.word)}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-[#8ea2ff]/12 text-[#8ea2ff] transition hover:bg-[#8ea2ff]/20 active:scale-95"
            title="Прослушать ещё раз"
            aria-label="Прослушать ещё раз"
          >
            <SpeakerIcon size={34} />
          </button>
          <p className="mt-3 text-sm text-[#6b6b76]">Нажмите, чтобы прослушать ещё раз</p>

          {status === 'revealed' && (
            <div className="mt-5 w-full rounded-xl bg-[#1b1b21] p-4">
              <p className="text-sm text-[#8a8a96]">Правильно:</p>
              <p className="mt-1 text-2xl font-bold text-[#ececf1]">{current.word}</p>
              {current.transcription && (
                <p className="mt-1 text-sm text-[#8a8a96]">{current.transcription}</p>
              )}
              <p className="mt-2 text-base text-[#8ea2ff]">{current.translation}</p>
            </div>
          )}
        </div>

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
          className={`field mt-4 min-h-[3.25rem]! text-center text-base disabled:opacity-70 ${
            status === 'correct'
              ? 'border-[#7fc8a0]!'
              : status === 'wrongOnce' || status === 'revealed'
              ? 'border-[#e5786f]!'
              : ''
          }`}
        />

        <div className="mt-2 min-h-[1.25rem] space-y-1 text-center text-sm">
          {status === 'wrongOnce' && (
            <p className="text-[#e5786f]">Неверно. Попробуйте ещё раз.</p>
          )}
          {status === 'correct' && <p className="text-[#7fc8a0]">Верно!</p>}
          {showHint && status !== 'revealed' && (
            <p className="text-[#b0b0bb]">Перевод: {current.translation}</p>
          )}
        </div>

        <div
          className={`mt-3 grid gap-3 ${
            status !== 'revealed' && status !== 'correct' ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {status !== 'revealed' && status !== 'correct' && (
            <button
              type="button"
              onClick={() => setShowHint(true)}
              className="btn btn-lg btn-secondary"
            >
              Подсказка
            </button>
          )}
          {status === 'revealed' ? (
            <button key="next" type="submit" autoFocus className="btn btn-lg btn-primary">
              Дальше
            </button>
          ) : (
            <button
              key="check"
              type="submit"
              disabled={status === 'correct' || !input.trim()}
              className="btn btn-lg btn-primary"
            >
              Проверить
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

const SCREEN =
  'mx-auto flex w-full max-w-xl flex-col px-4 min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]'

function SpeakerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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
