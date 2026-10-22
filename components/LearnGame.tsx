'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card } from '@/types/database'
import {
  STUDY_REINSERT_OFFSETS,
  StudyGameProps,
  insertAt,
  isSpellingCorrect,
  normalizeRu,
  shuffle,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { clearSession, loadSession, restoreQueue, saveSession } from '@/lib/session'

const MAX_STAGE = 3

const STAGE_LABELS = ['Карточки', 'Выбор', 'Написание', 'Пропуски']
const STAGE_HINTS = [
  'Вспомните перевод слова',
  'Выберите правильный перевод',
  'Напишите слово по-английски',
  'Вставьте пропущенные буквы',
]

type Result = 'good' | 'soft' | 'bad'
type Feedback = 'idle' | 'wrongOnce' | 'correct' | 'revealed'
type Pending = { card: Card; result: Result } | null

function hashSeed(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Индексы букв, которые нужно угадать. Первая буква остаётся видимой,
// если в слове больше двух букв.
function gapIndices(word: string, seed: number): number[] {
  const chars = Array.from(word)
  const letters: number[] = []
  chars.forEach((ch, i) => {
    if (/[a-zA-Z]/.test(ch)) letters.push(i)
  })
  if (letters.length === 0) return []

  const pool = letters.length > 2 ? letters.slice(1) : [...letters]
  let count = Math.max(1, Math.round(letters.length * 0.4))
  count = Math.min(count, pool.length)

  let state = seed || 1
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }

  const picked = [...pool]
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }

  return picked.slice(0, count).sort((a, b) => a - b)
}

function fillGaps(word: string, gaps: number[], typed: string): string {
  const chars = Array.from(word)
  gaps.forEach((idx, k) => {
    if (typed[k]) chars[idx] = typed[k]
  })
  return chars.join('')
}

export default function LearnGame({
  cards,
  recordResult,
  onNextRound,
  onExit,
}: StudyGameProps) {
  warmUpVoices()

  const pathname = usePathname()
  const sessionKey = `learn:${pathname}`

  // Если вернулись к незаконченному заучиванию, продолжаем с того же места
  const [restored] = useState(() => {
    const saved = loadSession(sessionKey)
    const q = restoreQueue(saved, cards)
    return saved && q ? { saved, queue: q } : null
  })

  const [queue, setQueue] = useState<Card[]>(restored ? restored.queue : cards)
  const [totalCards] = useState(restored ? restored.saved.total : cards.length)
  const [stages, setStages] = useState<Record<string, number>>(restored?.saved.stages ?? {})
  const [doneCount, setDoneCount] = useState(restored ? restored.saved.done : 0)
  const [failedCount, setFailedCount] = useState(restored?.saved.failed ?? 0)
  const [firstTryCount, setFirstTryCount] = useState(restored?.saved.firstTry ?? 0)
  const [mistakeCount, setMistakeCount] = useState(restored?.saved.mistakes ?? 0)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>(
    restored ? restored.saved.wrong : {}
  )
  const [isFinished, setIsFinished] = useState(cards.length === 0)

  const [turn, setTurn] = useState(0)
  const [input, setInput] = useState('')
  const [attempt, setAttempt] = useState(1)
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [showTranslation, setShowTranslation] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)

  const pendingRef = useRef<Pending>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = queue[0]
  const stage = current ? Math.min(stages[current.id] ?? 0, MAX_STAGE) : 0

  // Варианты перевода для этапа «Выбор»
  const options = useMemo(() => {
    if (!current || stage !== 1) return []
    const seen = new Set<string>([normalizeRu(current.translation)])
    const distractors: string[] = []
    for (const card of shuffle(cards)) {
      const value = normalizeRu(card.translation)
      if (!value || seen.has(value)) continue
      seen.add(value)
      distractors.push(card.translation)
      if (distractors.length === 3) break
    }
    return shuffle([current.translation, ...distractors])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, stage, turn])

  // Пропущенные буквы для этапа «Пропуски»
  const gaps = useMemo(() => {
    if (!current || stage !== 3) return []
    return gapIndices(current.word, hashSeed(`${current.word}:${turn}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, stage, turn])

  const report = (card: Card, correct: boolean) => {
    recordResult(card, correct).then(ok => {
      if (!ok) setSaveError(true)
    })
  }

  const resetEncounter = () => {
    pendingRef.current = null
    setInput('')
    setAttempt(1)
    setFeedback('idle')
    setShowTranslation(false)
    setShowHint(false)
    setSelected(null)
    setTurn(t => t + 1)
  }

  const finishEncounter = (card: Card, result: Result) => {
    const cardStage = stages[card.id] ?? 0
    const rest = queue.slice(1)

    if (result === 'bad') {
      report(card, false)
      setMistakeCount(n => n + 1)

      const wrongNow = (wrongSession[card.id] || 0) + 1
      setWrongSession(prev => ({ ...prev, [card.id]: wrongNow }))
      setStages(prev => ({ ...prev, [card.id]: Math.max(0, cardStage - 1) }))

      if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
        setQueue(insertAt(rest, card, STUDY_REINSERT_OFFSETS[wrongNow - 1]))
      } else {
        setDoneCount(d => d + 1)
        setFailedCount(f => f + 1)
        setQueue(rest)
        if (rest.length === 0) setIsFinished(true)
      }
    } else {
      if (result === 'good') {
        report(card, true)
        setFirstTryCount(n => n + 1)
      } else {
        report(card, false)
        setMistakeCount(n => n + 1)
      }

      if (cardStage >= MAX_STAGE) {
        setDoneCount(d => d + 1)
        setQueue(rest)
        if (rest.length === 0) setIsFinished(true)
      } else {
        setStages(prev => ({ ...prev, [card.id]: cardStage + 1 }))
        setQueue([...rest, card])
      }
    }

    resetEncounter()
  }

  function finishPending() {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    finishEncounter(pending.card, pending.result)
  }

  // Запоминаем ход заучивания (или стираем, если оно закончено)
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
      known: [],
      firstTry: firstTryCount,
      failed: failedCount,
      stages,
      mistakes: mistakeCount,
    })
  }, [
    queue,
    doneCount,
    wrongSession,
    firstTryCount,
    failedCount,
    stages,
    mistakeCount,
    isFinished,
    sessionKey,
    totalCards,
  ])

  useEffect(() => {
    if (feedback === 'correct') {
      const id = setTimeout(() => finishPending(), 700)
      return () => clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback])

  useEffect(() => {
    if ((stage === 2 || stage === 3) && (feedback === 'idle' || feedback === 'wrongOnce')) {
      inputRef.current?.focus()
    }
  }, [turn, feedback, stage])

  const handleExit = () => {
    clearSession(sessionKey)
    onExit()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!current) return

    if (feedback === 'revealed') {
      finishPending()
      return
    }
    if (feedback === 'correct') return
    if (stage !== 2 && stage !== 3) return

    if (stage === 3 && input.length !== gaps.length) return

    const value = input.trim()
    if (!value) return

    const correct =
      stage === 2
        ? isSpellingCorrect(value, current.word)
        : isSpellingCorrect(fillGaps(current.word, gaps, input), current.word)

    if (correct) {
      pendingRef.current = { card: current, result: attempt === 1 ? 'good' : 'soft' }
      setFeedback('correct')
      return
    }

    if (attempt === 1) {
      setAttempt(2)
      setFeedback('wrongOnce')
      setInput('')
      return
    }

    pendingRef.current = { card: current, result: 'bad' }
    setFeedback('revealed')
  }

  const handleOption = (option: string) => {
    if (!current || feedback !== 'idle') return

    if (normalizeRu(option) === normalizeRu(current.translation)) {
      pendingRef.current = { card: current, result: 'good' }
      setSelected(option)
      setFeedback('correct')
    } else {
      pendingRef.current = { card: current, result: 'bad' }
      setSelected(option)
      setFeedback('revealed')
    }
  }

  const handleFlashcardKnow = () => {
    if (!current || feedback !== 'idle') return
    pendingRef.current = { card: current, result: 'good' }
    setFeedback('correct')
  }

  const handleFlashcardDontKnow = () => {
    if (!current || feedback !== 'idle') return
    pendingRef.current = { card: current, result: 'bad' }
    setShowTranslation(true)
    setFeedback('revealed')
  }

  if (isFinished || !current) {
    const mastered = Math.max(doneCount - failedCount, 0)
    const attemptsTotal = firstTryCount + mistakeCount
    const accuracy = attemptsTotal > 0 ? Math.round((firstTryCount / attemptsTotal) * 100) : 0

    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-[#1a1d23] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {totalCards === 0 ? 'Нет слов для заучивания' : 'Заучивание завершено'}
          </h2>
          {totalCards > 0 && (
            <div className="mb-6 space-y-1 text-sm text-[#8b90a0]">
              <p>
                Выучено слов: <b className="text-[#e6e8ec]">{mastered}</b> из {totalCards}
              </p>
              <p>С первой попытки: {firstTryCount}</p>
              <p>Ошибок: {mistakeCount}</p>
              {failedCount > 0 && <p>Не осилено: {failedCount}</p>}
              <p>Точность: {accuracy}%</p>
            </div>
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
              onClick={handleExit}
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
  const maskedWord = Array.from(current.word)
    .map((ch, i) => {
      const gapPos = gaps.indexOf(i)
      if (gapPos === -1) return ch
      return input[gapPos] || '_'
    })
    .join('')

  const inputDisabled = feedback === 'correct' || feedback === 'revealed'
  const wrongBorder = feedback === 'wrongOnce' || feedback === 'revealed'

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-4 md:p-8 max-w-2xl mx-auto flex flex-col">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm text-center">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center justify-between mb-3 text-sm text-[#8b90a0]">
          <span>
            Заучивание · пройдено {doneCount} / {totalCards} · ошибок: {mistakeCount}
          </span>
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

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {STAGE_LABELS.map((label, i) => {
            const active = i === stage
            const passed = i < stage
            return (
              <span
                key={label}
                className={`rounded-full border px-3 py-1 transition ${
                  active
                    ? 'border-[#6c7cff] bg-[#6c7cff]/15 text-[#e6e8ec]'
                    : passed
                    ? 'border-green-500/40 text-green-400'
                    : 'border-gray-800 text-[#8b90a0]'
                }`}
              >
                {i + 1}. {label}
              </span>
            )
          })}
        </div>
        <p className="mt-2 text-center text-xs text-[#8b90a0]">{STAGE_HINTS[stage]}</p>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 md:p-8 shadow-2xl">
        {stage === 0 && (
          <div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => speak(current.word)}
                className="rounded-lg bg-[#0f1115] px-2.5 py-1.5 text-[#6c7cff] hover:bg-gray-800 transition"
                title="Озвучить"
              >
                🔊
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowTranslation(true)}
              className="w-full text-center"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-2">{current.word}</h2>
              {current.transcription && (
                <p className="text-sm text-[#8b90a0]">{current.transcription}</p>
              )}
              <div className="my-8 flex min-h-[72px] items-center justify-center">
                {showTranslation ? (
                  <p className="text-2xl font-bold text-[#6c7cff]">{current.translation}</p>
                ) : (
                  <span className="text-xs uppercase tracking-wider text-[#8b90a0]">
                    Нажмите, чтобы показать перевод
                  </span>
                )}
              </div>
            </button>

            {showTranslation && current.sentences && current.sentences.length > 0 && (
              <div className="mb-4 space-y-1.5 rounded-xl bg-[#0f1115] p-3 text-xs text-[#8b90a0]">
                {current.sentences.map((s, i) => (
                  <p key={i}>• {s}</p>
                ))}
              </div>
            )}

            {feedback === 'revealed' ? (
              <button
                type="button"
                onClick={finishPending}
                autoFocus
                className="w-full rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition"
              >
                Дальше
              </button>
            ) : showTranslation ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleFlashcardDontKnow}
                  disabled={feedback !== 'idle'}
                  className="rounded-xl border border-[#a04a4a] bg-[#a04a4a]/10 py-3 font-semibold text-[#a04a4a] hover:bg-[#a04a4a]/20 transition disabled:opacity-50"
                >
                  Не знаю
                </button>
                <button
                  type="button"
                  onClick={handleFlashcardKnow}
                  disabled={feedback !== 'idle'}
                  className="rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition disabled:opacity-50"
                >
                  Знаю
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTranslation(true)}
                className="w-full rounded-xl border border-gray-700 py-3 font-semibold hover:border-[#6c7cff] transition"
              >
                Показать перевод
              </button>
            )}
          </div>
        )}

        {stage === 1 && (
          <div>
            <div className="mb-6 text-center">
              <p className="text-2xl md:text-3xl font-bold">{current.word}</p>
              {current.transcription && (
                <p className="mt-1 text-sm text-[#8b90a0]">{current.transcription}</p>
              )}
              <button
                type="button"
                onClick={() => speak(current.word)}
                className="mt-2 rounded-lg bg-[#0f1115] px-2.5 py-1.5 text-[#6c7cff] hover:bg-gray-800 transition"
                title="Озвучить"
              >
                🔊
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {options.map(option => {
                const isCorrect = normalizeRu(option) === normalizeRu(current.translation)
                const isChosen = selected === option

                let state = 'border-gray-700 bg-[#0f1115] hover:border-[#6c7cff]'
                if (feedback === 'correct' && isCorrect) state = 'border-green-500 bg-green-500/10'
                else if (feedback === 'revealed') {
                  if (isCorrect) state = 'border-green-500 bg-green-500/10'
                  else if (isChosen) state = 'border-[#a04a4a] bg-[#a04a4a]/15'
                }

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleOption(option)}
                    disabled={feedback !== 'idle'}
                    className={`rounded-xl border p-4 text-left text-sm font-medium transition disabled:cursor-default ${state}`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>

            {feedback === 'correct' && (
              <p className="mt-4 text-center text-sm text-green-400">Верно!</p>
            )}
            {feedback === 'revealed' && (
              <div className="mt-4 text-center">
                <p className="mb-3 text-sm text-[#a04a4a]">
                  Неверно. Правильный перевод: <b className="text-[#e6e8ec]">{current.translation}</b>
                </p>
                <button
                  type="button"
                  onClick={finishPending}
                  autoFocus
                  className="w-full rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition"
                >
                  Дальше
                </button>
              </div>
            )}
          </div>
        )}

        {(stage === 2 || stage === 3) && (
          <form onSubmit={handleSubmit}>
            <div className="mb-6 text-center">
              <p className="mb-2 text-sm text-[#8b90a0]">
                {stage === 2 ? 'Напишите слово по-английски' : 'Вставьте пропущенные буквы'}
              </p>
              <p className="text-xl font-semibold">{current.translation}</p>

              {stage === 3 && (
                <p className="mt-6 whitespace-pre-wrap break-all font-mono text-3xl tracking-[0.25em] text-[#e6e8ec]">
                  {maskedWord}
                </p>
              )}
            </div>

            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e =>
                setInput(
                  stage === 3
                    ? e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, gaps.length)
                    : e.target.value
                )
              }
              disabled={inputDisabled}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              placeholder={
                stage === 2 ? 'Введите слово по-английски' : 'Введите пропущенные буквы'
              }
              className={`w-full rounded-lg border bg-[#0f1115] p-3 text-center text-lg text-[#e6e8ec] outline-none disabled:opacity-70 ${
                feedback === 'correct'
                  ? 'border-green-500'
                  : wrongBorder
                  ? 'border-[#a04a4a]'
                  : 'border-gray-700 focus:border-[#6c7cff]'
              }`}
            />

            {stage === 3 && (
              <p className="mt-2 text-center text-xs text-[#8b90a0]">
                {input.length} / {gaps.length}
              </p>
            )}

            {feedback === 'wrongOnce' && (
              <p className="mt-3 text-center text-sm text-[#a04a4a]">
                Неверно. Попробуйте ещё раз.
              </p>
            )}
            {feedback === 'correct' && (
              <p className="mt-3 text-center text-sm text-green-400">
                {attempt === 1 ? 'Верно!' : 'Верно, но со второй попытки'}
              </p>
            )}
            {feedback === 'revealed' && (
              <div className="mt-3 rounded-xl bg-[#0f1115] p-4 text-center">
                <p className="mb-1 text-sm text-[#8b90a0]">Правильно:</p>
                <p className="text-2xl font-bold text-[#6c7cff]">{current.word}</p>
                {current.transcription && (
                  <p className="mt-1 text-sm text-[#8b90a0]">{current.transcription}</p>
                )}
              </div>
            )}

            {showHint && stage === 2 && feedback !== 'revealed' && (
              <p className="mt-3 text-center text-sm text-[#8b90a0]">
                Начинается на «{current.word[0]}», букв: {current.word.replace(/[^a-zA-Z]/g, '').length}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              {feedback !== 'revealed' && feedback !== 'correct' && stage === 2 && (
                <button
                  type="button"
                  onClick={() => setShowHint(true)}
                  className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-medium hover:border-[#6c7cff] transition"
                >
                  Подсказка
                </button>
              )}
              {feedback === 'revealed' ? (
                <button
                  type="submit"
                  autoFocus
                  className="flex-1 rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition"
                >
                  Дальше
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    feedback === 'correct' ||
                    !input.trim() ||
                    (stage === 3 && input.length !== gaps.length)
                  }
                  className="flex-1 rounded-xl bg-[#6c7cff] py-3 font-semibold text-white hover:bg-[#5865e0] transition disabled:opacity-50"
                >
                  Проверить
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// конец файла
