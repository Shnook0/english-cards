'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card } from '@/types/database'
import {
  BOT_REPEAT_MISTAKE_THRESHOLD,
  STUDY_REINSERT_OFFSETS,
  StudyGameProps,
  insertAt,
  isSpellingCorrect,
  normalizeRu,
  queueBotRepeat,
  shuffle,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { clearSession, loadSession, restoreQueue, saveSession } from '@/lib/session'
import Icon from '@/components/ui/Icon'

const MAX_STAGE = 3
const BATCH_SIZE = 10
const CARRY_MISTAKES = 2
// Прогресс по партиям помним дольше, чем обычную сессию
const LEARN_TTL_MS = 7 * 24 * 60 * 60 * 1000

const STAGE_LABELS = ['Карточки', 'Выбор', 'Пропуски', 'Написание']
const STAGE_HINTS = [
  'Вспомните перевод слова',
  'Выберите правильный перевод',
  'Вставьте пропущенные буквы',
  'Напишите слово по-английски',
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
  // v2: сначала пропуски, затем полное написание
  const sessionKey = `learn:v2:${pathname}`

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const initialBatchCards = cards.slice(0, BATCH_SIZE)
  const initialPoolIds = cards.slice(BATCH_SIZE).map(c => c.id)

  // Если вернулись к незаконченному заучиванию, продолжаем с того же места
  const [restored] = useState(() => {
    const saved = loadSession(sessionKey, LEARN_TTL_MS)
    if (!saved) return null
    // Старое сохранение без партий не подходит — начинаем заново
    if (!Array.isArray(saved.batchIds) || !Array.isArray(saved.poolIds)) return null
    // Партия уже закончена — показываем итог и ждём выбора
    if (saved.betweenBatches) return { saved, queue: [] as Card[] }
    const q = restoreQueue(saved, cards)
    return q ? { saved, queue: q } : null
  })

  const [queue, setQueue] = useState<Card[]>(restored ? restored.queue : initialBatchCards)
  const [totalCards, setTotalCards] = useState(
    restored ? restored.saved.total : initialBatchCards.length
  )
  const [stages, setStages] = useState<Record<string, number>>(restored?.saved.stages ?? {})
  const [doneCount, setDoneCount] = useState(restored ? restored.saved.done : 0)
  const [failedCount, setFailedCount] = useState(restored?.saved.failed ?? 0)
  const [firstTryCount, setFirstTryCount] = useState(restored?.saved.firstTry ?? 0)
  const [mistakeCount, setMistakeCount] = useState(restored?.saved.mistakes ?? 0)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>(
    restored ? restored.saved.wrong : {}
  )
  const [cardMistakes, setCardMistakes] = useState<Record<string, number>>(
    restored?.saved.cardMistakes ?? {}
  )

  const [batchNo, setBatchNo] = useState(restored?.saved.batchNo ?? 1)
  const [batchIds, setBatchIds] = useState<string[]>(() => {
    if (restored?.saved.batchIds) return restored.saved.batchIds.filter(id => cardById.has(id))
    return initialBatchCards.map(c => c.id)
  })
  const [poolIds, setPoolIds] = useState<string[]>(() => {
    if (restored?.saved.poolIds) return restored.saved.poolIds.filter(id => cardById.has(id))
    return initialPoolIds
  })
  const [betweenBatches, setBetweenBatches] = useState(restored?.saved.betweenBatches ?? false)

  const [turn, setTurn] = useState(0)
  const [input, setInput] = useState('')
  const [attempt, setAttempt] = useState(1)
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [showTranslation, setShowTranslation] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)

  const pendingRef = useRef<Pending>(null)
  const autoAdvanceRef = useRef(false)
  const botQueuedRef = useRef<Set<string>>(new Set())
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
    if (!current || stage !== 2) return []
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
    autoAdvanceRef.current = false
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
      setCardMistakes(prev => ({ ...prev, [card.id]: (prev[card.id] || 0) + 1 }))

      const wrongNow = (wrongSession[card.id] || 0) + 1
      setWrongSession(prev => ({ ...prev, [card.id]: wrongNow }))
      setStages(prev => ({ ...prev, [card.id]: Math.max(0, cardStage - 1) }))

      if (
        wrongNow >= BOT_REPEAT_MISTAKE_THRESHOLD &&
        !botQueuedRef.current.has(card.id)
      ) {
        botQueuedRef.current.add(card.id)
        void queueBotRepeat(card.id)
      }

      if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
        setQueue(insertAt(rest, card, STUDY_REINSERT_OFFSETS[wrongNow - 1]))
      } else {
        setDoneCount(d => d + 1)
        setFailedCount(f => f + 1)
        setQueue(rest)
        if (rest.length === 0) setBetweenBatches(true)
      }
    } else {
      if (result === 'good') {
        report(card, true)
        setFirstTryCount(n => n + 1)
      } else {
        report(card, false)
        setMistakeCount(n => n + 1)
        setCardMistakes(prev => ({ ...prev, [card.id]: (prev[card.id] || 0) + 1 }))
      }

      if (cardStage >= MAX_STAGE) {
        setDoneCount(d => d + 1)
        setQueue(rest)
        if (rest.length === 0) setBetweenBatches(true)
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

  // Запоминаем партию, чтобы можно было продолжить после перезагрузки
  useEffect(() => {
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
      poolIds,
      batchIds,
      batchNo,
      betweenBatches,
      cardMistakes,
    })
  }, [
    queue,
    doneCount,
    wrongSession,
    firstTryCount,
    failedCount,
    stages,
    mistakeCount,
    poolIds,
    batchIds,
    batchNo,
    betweenBatches,
    cardMistakes,
    sessionKey,
    totalCards,
  ])

  useEffect(() => {
    if (feedback === 'correct') {
      const id = setTimeout(() => finishPending(), 700)
      return () => clearTimeout(id)
    }
    if (feedback === 'revealed' && autoAdvanceRef.current) {
      autoAdvanceRef.current = false
      const id = setTimeout(() => finishPending(), 900)
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

    if (stage === 2 && input.length !== gaps.length) return

    const value = input.trim()
    if (!value) return

    const correct =
      stage === 2
        ? isSpellingCorrect(fillGaps(current.word, gaps, input), current.word)
        : isSpellingCorrect(value, current.word)

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
    autoAdvanceRef.current = true
    setShowTranslation(true)
    setFeedback('revealed')
  }

  // Слова с двумя и более ошибками переносятся в следующую партию
  const carryover = batchIds
    .filter(id => (cardMistakes[id] ?? 0) >= CARRY_MISTAKES)
    .map(id => cardById.get(id))
    .filter((c): c is Card => !!c)

  const availableNew = poolIds
    .map(id => cardById.get(id))
    .filter((c): c is Card => !!c)

  const startNextBatch = () => {
    if (carryover.length === 0 && availableNew.length === 0) return

    const slots = Math.max(0, BATCH_SIZE - carryover.length)
    const newCards = availableNew.slice(0, slots)
    const nextBatch = [...carryover, ...newCards]
    const newIds = new Set(newCards.map(c => c.id))

    setQueue(nextBatch)
    setBatchIds(nextBatch.map(c => c.id))
    setPoolIds(availableNew.filter(c => !newIds.has(c.id)).map(c => c.id))
    setTotalCards(nextBatch.length)
    setStages({})
    setWrongSession({})
    setCardMistakes({})
    setDoneCount(0)
    setFailedCount(0)
    setFirstTryCount(0)
    setMistakeCount(0)
    setBatchNo(n => n + 1)
    setBetweenBatches(false)
    resetEncounter()
  }

  const restartFolder = () => {
    clearSession(sessionKey)
    onNextRound()
  }

  if (betweenBatches || !current) {
    const mastered = Math.max(doneCount - failedCount, 0)
    const attemptsTotal = firstTryCount + mistakeCount
    const accuracy = attemptsTotal > 0 ? Math.round((firstTryCount / attemptsTotal) * 100) : 0
    const folderComplete = carryover.length === 0 && availableNew.length === 0

    return (
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in p-6 text-center sm:p-8">
          <h2 className="text-xl">
            {totalCards === 0
              ? 'Нет слов для заучивания'
              : folderComplete
              ? 'Все слова из папки пройдены'
              : `Партия ${batchNo} завершена`}
          </h2>
          {totalCards > 0 && (
            <>
              <p className="mt-5 text-5xl font-bold leading-none text-[#8ea2ff]">
                {mastered}
                <span className="text-2xl font-semibold text-[#6b6b76]"> / {totalCards}</span>
              </p>
              <p className="mt-2 text-sm text-[#8a8a96]">слов пройдено</p>

              <dl className="mt-6 divide-y divide-[#24242b] rounded-xl bg-[#1b1b21] px-4 text-left text-sm">
                <StatRow label="С первой попытки" value={firstTryCount} />
                <StatRow label="Ошибок" value={mistakeCount} />
                {failedCount > 0 && <StatRow label="Не осилено" value={failedCount} />}
                <StatRow label="Точность" value={`${accuracy}%`} />
                {carryover.length > 0 && (
                  <StatRow label="Перенесено в следующую партию" value={carryover.length} />
                )}
                {availableNew.length > 0 && (
                  <StatRow label="Осталось новых слов в папке" value={availableNew.length} />
                )}
              </dl>
            </>
          )}
          <div className="mt-7 flex flex-col gap-3">
            {folderComplete ? (
              totalCards > 0 && (
                <button onClick={restartFolder} className="btn btn-primary btn-lg btn-block">
                  Начать заново
                </button>
              )
            ) : (
              <button onClick={startNextBatch} className="btn btn-primary btn-lg btn-block">
                Следующее заучивание
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
  const maskedWord = Array.from(current.word)
    .map((ch, i) => {
      const gapPos = gaps.indexOf(i)
      if (gapPos === -1) return ch
      return input[gapPos] || '_'
    })
    .join('')

  const inputDisabled = feedback === 'correct' || feedback === 'revealed'
  const wrongBorder = feedback === 'wrongOnce' || feedback === 'revealed'

  const sentences =
    current.sentences && current.sentences.length > 0 ? (
      <div className="mt-5 space-y-2 rounded-xl bg-[#1b1b21] p-4 text-left text-sm leading-relaxed text-[#b0b0bb]">
        {current.sentences.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </div>
    ) : null

  return (
    <div className={`${SCREEN} pb-4`}>
      <header className="pt-2">
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExit} className="btn btn-ghost btn-sm -ml-3">
            <Icon name="arrowLeft" size={16} />
            Выйти
          </button>
          <span className="text-right text-sm font-medium tabular-nums text-[#b0b0bb]">
            Партия {batchNo} · {doneCount} из {totalCards}
            {mistakeCount > 0 && <span className="text-[#e5786f]"> · ошибок {mistakeCount}</span>}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#1b1b21]">
          <div
            className="h-full rounded-full bg-[#8ea2ff] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <ol className="mt-4 grid grid-cols-4 gap-2">
          {STAGE_LABELS.map((label, i) => {
            const active = i === stage
            const passed = i < stage
            return (
              <li key={label} className="min-w-0">
                <div
                  className={`h-1 rounded-full transition-colors ${
                    active ? 'bg-[#8ea2ff]' : passed ? 'bg-[#7fc8a0]' : 'bg-[#24242b]'
                  }`}
                />
                <p
                  className={`mt-1.5 truncate text-center text-xs ${
                    active
                      ? 'font-semibold text-[#ececf1]'
                      : passed
                      ? 'text-[#7fc8a0]'
                      : 'text-[#6b6b76]'
                  }`}
                >
                  {label}
                </p>
              </li>
            )
          })}
        </ol>
      </header>

      {saveError && (
        <div className="mt-4 rounded-xl border border-[#e5786f]/35 bg-[#e5786f]/10 px-4 py-3 text-center text-sm text-[#e5786f]">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      {stage === 0 && (
        <>
          <main className="flex flex-1 flex-col justify-center py-6">
            <p className="mb-3 text-center text-sm text-[#8a8a96]">{STAGE_HINTS[0]}, затем откройте карточку</p>
            <div className="card relative p-5 sm:p-7">
              <button
                type="button"
                onClick={() => speak(current.word)}
                className="icon-btn absolute right-4 top-4 text-[#8ea2ff]!"
                title="Озвучить"
                aria-label="Озвучить"
              >
                <SpeakerIcon />
              </button>

              <button
                type="button"
                onClick={() => setShowTranslation(true)}
                className="block w-full select-none pt-10 text-center"
              >
                <h2 className="break-words text-3xl font-bold sm:text-4xl">{current.word}</h2>
                {current.transcription && (
                  <p className="mt-2 text-base text-[#8a8a96]">{current.transcription}</p>
                )}
                <div className="my-6 flex min-h-[3rem] items-center justify-center">
                  {showTranslation ? (
                    <p className="text-2xl font-semibold text-[#8ea2ff]">{current.translation}</p>
                  ) : (
                    <span className="text-sm text-[#6b6b76]">Нажмите, чтобы увидеть перевод</span>
                  )}
                </div>
                {sentences}
              </button>
            </div>
          </main>

          <footer className="min-h-[3.25rem]">
            {feedback === 'revealed' ? (
              <div className="flex min-h-[3.25rem] items-center justify-center rounded-[14px] bg-[#e5786f]/10 text-sm font-medium text-[#e5786f]">
                Следующая карточка…
              </div>
            ) : showTranslation ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleFlashcardDontKnow}
                  disabled={feedback !== 'idle'}
                  className="btn btn-lg btn-danger"
                >
                  Не знаю
                </button>
                <button
                  type="button"
                  onClick={handleFlashcardKnow}
                  disabled={feedback !== 'idle'}
                  className="btn btn-lg btn-primary"
                >
                  Знаю
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTranslation(true)}
                className="btn btn-lg btn-block btn-secondary"
              >
                Показать перевод
              </button>
            )}
          </footer>
        </>
      )}

      {stage === 1 && (
        <>
          <main className="flex flex-1 flex-col justify-center py-6">
            <p className="mb-3 text-center text-sm text-[#8a8a96]">{STAGE_HINTS[1]}</p>
            <div className="card p-5 text-center sm:p-7">
              <p className="break-words text-3xl font-bold sm:text-4xl">{current.word}</p>
              <div className="mt-2 flex items-center justify-center gap-3">
                {current.transcription && (
                  <p className="text-base text-[#8a8a96]">{current.transcription}</p>
                )}
                <button
                  type="button"
                  onClick={() => speak(current.word)}
                  className="icon-btn h-9! w-9! text-[#8ea2ff]!"
                  title="Озвучить"
                  aria-label="Озвучить"
                >
                  <SpeakerIcon size={18} />
                </button>
              </div>
              {sentences}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {options.map(option => {
                const isCorrect = normalizeRu(option) === normalizeRu(current.translation)
                const isChosen = selected === option

                let state =
                  'border-[#2c2c34] bg-[#15151a] text-[#ececf1] hover:border-[#8ea2ff]'
                if (feedback === 'correct' && isCorrect)
                  state = 'border-[#7fc8a0] bg-[#7fc8a0]/10 text-[#7fc8a0]'
                else if (feedback === 'revealed') {
                  if (isCorrect) state = 'border-[#7fc8a0] bg-[#7fc8a0]/10 text-[#7fc8a0]'
                  else if (isChosen) state = 'border-[#e5786f] bg-[#e5786f]/10 text-[#e5786f]'
                  else state = 'border-[#24242b] bg-[#15151a] text-[#6b6b76]'
                }

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleOption(option)}
                    disabled={feedback !== 'idle'}
                    className={`flex min-h-[3.25rem] items-center justify-center rounded-[14px] border px-4 py-3 text-center text-base font-medium transition disabled:cursor-default ${state}`}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          </main>

          <footer className="min-h-[3.25rem]">
            {feedback === 'correct' && (
              <p className="flex min-h-[3.25rem] items-center justify-center text-base font-semibold text-[#7fc8a0]">
                Верно!
              </p>
            )}
            {feedback === 'revealed' && (
              <div>
                <p className="mb-3 text-center text-sm text-[#e5786f]">
                  Неверно. Правильный перевод:{' '}
                  <b className="font-semibold text-[#ececf1]">{current.translation}</b>
                </p>
                <button
                  type="button"
                  onClick={finishPending}
                  autoFocus
                  className="btn btn-lg btn-block btn-primary"
                >
                  Дальше
                </button>
              </div>
            )}
          </footer>
        </>
      )}

      {(stage === 2 || stage === 3) && (
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col py-6">
          <p className="mb-3 text-center text-sm text-[#8a8a96]">
            {stage === 2
              ? 'Вставьте пропущенные буквы и нажмите «Проверить»'
              : 'Напишите слово по-английски и нажмите «Проверить»'}
          </p>

          <div className="card p-5 text-center sm:p-7">
            <p className="text-sm text-[#8a8a96]">Перевод</p>
            <p className="mt-1 text-2xl font-semibold text-[#8ea2ff]">{current.translation}</p>

            {stage === 2 && (
              <p className="mt-5 whitespace-pre-wrap break-all font-mono text-3xl text-[#ececf1]">
                {maskedWord}
              </p>
            )}

            {feedback === 'revealed' && (
              <div className="mt-5 rounded-xl bg-[#1b1b21] p-4">
                <p className="text-sm text-[#8a8a96]">Правильно:</p>
                <p className="mt-1 text-2xl font-bold text-[#ececf1]">{current.word}</p>
                {current.transcription && (
                  <p className="mt-1 text-sm text-[#8a8a96]">{current.transcription}</p>
                )}
              </div>
            )}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e =>
              setInput(
                stage === 2
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
              stage === 2 ? 'Введите пропущенные буквы' : 'Введите слово по-английски'
            }
            className={`field mt-4 min-h-[3.25rem]! text-center text-base disabled:opacity-70 ${
              feedback === 'correct'
                ? 'border-[#7fc8a0]!'
                : wrongBorder
                ? 'border-[#e5786f]!'
                : ''
            }`}
          />

          <div className="mt-2 min-h-[1.25rem] space-y-1 text-center text-sm">
            {stage === 2 && (
              <p className="tabular-nums text-[#6b6b76]">
                {input.length} / {gaps.length}
              </p>
            )}
            {feedback === 'wrongOnce' && (
              <p className="text-[#e5786f]">Неверно. Попробуйте ещё раз.</p>
            )}
            {feedback === 'correct' && (
              <p className="text-[#7fc8a0]">
                {attempt === 1 ? 'Верно!' : 'Верно, но со второй попытки'}
              </p>
            )}
            {showHint && stage === 3 && feedback !== 'revealed' && (
              <p className="text-[#b0b0bb]">
                Начинается на «{current.word[0]}», букв:{' '}
                {current.word.replace(/[^a-zA-Z]/g, '').length}
              </p>
            )}
          </div>

          <div
            className={`mt-3 grid gap-3 ${
              feedback !== 'revealed' && feedback !== 'correct' && stage === 3
                ? 'grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
            {feedback !== 'revealed' && feedback !== 'correct' && stage === 3 && (
              <button
                type="button"
                onClick={() => setShowHint(true)}
                className="btn btn-lg btn-secondary"
              >
                Подсказка
              </button>
            )}
            {feedback === 'revealed' ? (
              <button type="submit" autoFocus className="btn btn-lg btn-primary">
                Дальше
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  feedback === 'correct' ||
                  !input.trim() ||
                  (stage === 2 && input.length !== gaps.length)
                }
                className="btn btn-lg btn-primary"
              >
                Проверить
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

const SCREEN =
  'mx-auto flex w-full max-w-xl flex-col px-4 min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]'

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[#8a8a96]">{label}</dt>
      <dd className="font-semibold tabular-nums text-[#ececf1]">{value}</dd>
    </div>
  )
}

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
