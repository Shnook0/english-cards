'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Card } from '@/types/database'
import {
  STUDY_REINSERT_OFFSETS,
  StudyGameProps,
  isTranslationCorrect,
  speak,
  warmUpVoices,
} from '@/lib/study'
import { fetchBestScore, saveBestScore } from '@/lib/blocksRecord'
import {
  COLORS,
  Drag,
  Piece,
  canPlace,
  computeDrag,
  emptyBoard,
  fitsAnywhere,
  makePiece,
  placeOnBoard,
} from '@/lib/blocks'
import Icon from '@/components/ui/Icon'

type Phase = 'question' | 'placing' | 'revealed' | 'over' | 'finished'

export default function BlocksGame({ cards, recordResult, onNextRound, onExit }: StudyGameProps) {
  warmUpVoices()

  // Рекорд хранится отдельно для каждой папки (ключ берём из адреса страницы)
  const pathname = usePathname()
  const recordScope = `blocks:${pathname}`

  const [queue, setQueue] = useState<Card[]>(cards)
  const [doneCount, setDoneCount] = useState(0)
  const [phase, setPhase] = useState<Phase>(cards.length === 0 ? 'finished' : 'question')
  const [input, setInput] = useState('')
  const [attempt, setAttempt] = useState(1)
  const [turn, setTurn] = useState(0)
  const [wrongSession, setWrongSession] = useState<Record<string, number>>({})
  const [board, setBoard] = useState<number[][]>(emptyBoard)
  const [score, setScore] = useState(0)
  const [gain, setGain] = useState<{ value: number; key: number } | null>(null)
  const [best, setBest] = useState(0)
  const [newRecord, setNewRecord] = useState(false)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [lastAnswer, setLastAnswer] = useState<{ word: string; translation: string } | null>(null)
  const [saveError, setSaveError] = useState(false)

  const pieceIdRef = useRef(1)
  const gainKeyRef = useRef(0)
  const bestSavedRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pieceId: number; touch: boolean } | null>(null)
  const latestRef = useRef<{
    board: number[][]
    pieces: Piece[]
    place: (piece: Piece, r0: number, c0: number) => void
  } | null>(null)

  const current = queue[0]

  // Загружаем рекорд
  useEffect(() => {
    fetchBestScore(recordScope).then(v => {
      bestSavedRef.current = v
      setBest(v)
    })
  }, [recordScope])

  useEffect(() => {
    if (phase === 'question') inputRef.current?.focus()
  }, [phase, turn])

  // «+N» рядом со счётом исчезает через секунду
  useEffect(() => {
    if (!gain) return
    const id = setTimeout(() => setGain(null), 1200)
    return () => clearTimeout(id)
  }, [gain])

  const report = (card: Card, correct: boolean) => {
    recordResult(card, correct).then(ok => {
      if (!ok) setSaveError(true)
    })
  }

  const saveRecordIfNeeded = (finalScore: number) => {
    if (finalScore <= bestSavedRef.current) return
    bestSavedRef.current = finalScore
    setBest(finalScore)
    saveBestScore(recordScope, finalScore).then(ok => {
      if (!ok) setSaveError(true)
    })
  }

  const handleExit = () => {
    saveRecordIfNeeded(score)
    onExit()
  }

  const resetInput = () => {
    setInput('')
    setAttempt(1)
    setTurn(t => t + 1)
  }

  // Верный ответ: выдаём 3 фигуры
  const dealPieces = () => {
    const ps = [0, 1, 2].map(() => makePiece(pieceIdRef.current++))
    setPieces(ps)
    if (!ps.some(p => fitsAnywhere(board, p))) {
      saveRecordIfNeeded(score)
      setPhase('over')
      return
    }
    setPhase('placing')
  }

  // «Не знаю» или вторая неверная попытка: ошибка + показываем правильный ответ
  const failWord = () => {
    if (!current) return
    report(current, false)
    setPhase('revealed')
  }

  const goNextAfterFail = () => {
    if (!current) return
    const key = current.id
    const wrongNow = (wrongSession[key] || 0) + 1
    setWrongSession(prev => ({ ...prev, [key]: wrongNow }))

    const rest = queue.slice(1)
    let newQ: Card[]
    if (wrongNow <= STUDY_REINSERT_OFFSETS.length) {
      // Слово вернётся через 2 / 10 / 15 слов
      const at = Math.min(STUDY_REINSERT_OFFSETS[wrongNow - 1], rest.length)
      newQ = [...rest]
      newQ.splice(at, 0, current)
    } else {
      setDoneCount(d => d + 1)
      newQ = rest
    }
    setQueue(newQ)
    resetInput()
    setPhase(newQ.length === 0 ? 'finished' : 'question')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (phase === 'revealed') {
      goNextAfterFail()
      return
    }
    if (phase !== 'question' || !current) return

    const value = input.trim()
    if (!value) return

    if (isTranslationCorrect(value, current.translation)) {
      // С первой попытки — «Знаю»; со второй — слово просто пройдено
      if (attempt === 1) report(current, true)
      setLastAnswer({ word: current.word, translation: current.translation })
      setQueue(queue.slice(1))
      setDoneCount(d => d + 1)
      dealPieces()
      return
    }

    if (attempt === 1) {
      setAttempt(2)
      setInput('')
      return
    }

    failWord()
  }

  const placePiece = (piece: Piece, r0: number, c0: number) => {
    if (!canPlace(board, piece, r0, c0)) return

    const { board: nb, cleared } = placeOnBoard(board, piece, r0, c0)
    const remaining = pieces.filter(p => p.id !== piece.id)

    // Очки: 1 за клетку + бонус за линии (1 линия = 10, 2 = 40, 3 = 90)
    const gained = piece.cells.length + cleared * cleared * 10
    const newScore = score + gained

    setBoard(nb)
    setScore(newScore)
    setPieces(remaining)
    gainKeyRef.current += 1
    setGain({ value: gained, key: gainKeyRef.current })
    if (newScore > bestSavedRef.current) setNewRecord(true)

    if (remaining.length === 0) {
      // Все три фигуры поставлены → сохраняем рекорд и идём к следующему слову
      saveRecordIfNeeded(newScore)
      resetInput()
      setPhase(queue.length === 0 ? 'finished' : 'question')
      return
    }
    if (!remaining.some(p => fitsAnywhere(nb, p))) {
      saveRecordIfNeeded(newScore)
      setPhase('over')
    }
  }

  // Всегда храним свежие данные для обработчиков перетаскивания
  useEffect(() => {
    latestRef.current = { board, pieces, place: placePiece }
  })

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, piece: Piece) => {
    if (phase !== 'placing') return
    e.preventDefault()
    const touch = e.pointerType !== 'mouse'
    dragRef.current = { pieceId: piece.id, touch }
    setDrag(computeDrag(piece, e.clientX, e.clientY, touch, board, boardRef.current))
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current
      const latest = latestRef.current
      if (!d || !latest) return
      const piece = latest.pieces.find(p => p.id === d.pieceId)
      if (piece) {
        setDrag(computeDrag(piece, e.clientX, e.clientY, d.touch, latest.board, boardRef.current))
      }
    }

    const handleUp = (e: PointerEvent) => {
      const d = dragRef.current
      const latest = latestRef.current
      dragRef.current = null
      setDrag(null)
      if (!d || !latest) return
      const piece = latest.pieces.find(p => p.id === d.pieceId)
      if (!piece) return
      const res = computeDrag(piece, e.clientX, e.clientY, d.touch, latest.board, boardRef.current)
      if (res.target) latest.place(piece, res.target[0], res.target[1])
    }

    const handleCancel = () => {
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  }, [dragging])

  const restartGame = () => {
    setBoard(emptyBoard())
    setScore(0)
    setGain(null)
    setNewRecord(false)
    setPieces([])
    setDrag(null)
    setLastAnswer(null)
    resetInput()
    setPhase(queue.length === 0 ? 'finished' : 'question')
  }

  const shownBest = Math.max(best, score)

  if (phase === 'finished') {
    return (
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in mx-auto w-full max-w-xl p-6 text-center sm:p-8">
          <h2 className="text-xl">
            {cards.length === 0 ? 'Нет слов для игры' : 'Слова закончились'}
          </h2>
          {cards.length > 0 && (
            <>
              <p className="mt-5 text-5xl font-bold leading-none tabular-nums text-[#8ea2ff]">
                {score}
              </p>
              <p className="mt-2 text-sm text-[#8a8a96]">очков · слов пройдено: {doneCount}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {newRecord ? (
                  <span className="chip chip-success">Новый рекорд!</span>
                ) : null}
                <span className="chip">Рекорд: {shownBest}</span>
              </div>
            </>
          )}
          <div className="mt-7 flex flex-col gap-3">
            {cards.length > 0 && (
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

  if (phase === 'over') {
    return (
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in mx-auto w-full max-w-xl p-6 text-center sm:p-8">
          <h2 className="text-xl">Игра окончена</h2>
          <p className="mt-5 text-5xl font-bold leading-none tabular-nums text-[#8ea2ff]">{score}</p>
          <p className="mt-2 text-sm text-[#8a8a96]">
            очков · фигуры больше не помещаются на поле
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {newRecord && <span className="chip chip-success">Новый рекорд!</span>}
            <span className="chip">Рекорд: {shownBest}</span>
            <span className="chip">Слов пройдено: {doneCount}</span>
          </div>
          <div className="mt-7 flex flex-col gap-3">
            <button onClick={restartGame} className="btn btn-primary btn-lg btn-block">
              Играть снова
            </button>
            <button onClick={handleExit} className="btn btn-secondary btn-lg btn-block">
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Какие клетки подсветить, пока фигуру тащат над полем
  const draggedPiece = drag ? pieces.find(p => p.id === drag.pieceId) : undefined
  const previewCells = new Set<string>()
  if (drag?.target && draggedPiece) {
    for (const [dr, dc] of draggedPiece.cells) {
      previewCells.add(`${drag.target[0] + dr},${drag.target[1] + dc}`)
    }
  }

  return (
    <div className={`${SCREEN} pb-6`}>
      <header className="pt-2">
        <div className="flex items-center justify-between gap-3">
          <button onClick={handleExit} className="btn btn-ghost btn-sm -ml-3">
            <Icon name="arrowLeft" size={16} />
            Выйти
          </button>
          <span className="text-sm font-medium tabular-nums text-[#b0b0bb]">
            Блоки · слов: {doneCount}
          </span>
        </div>

        <div className="mt-3 flex items-end justify-between rounded-[14px] bg-[#15151a] px-4 py-3">
          <div>
            <p className="text-xs text-[#8a8a96]">Очки</p>
            <p className="text-3xl font-bold leading-tight tabular-nums">
              {score}
              {gain && (
                <span key={gain.key} className="ml-2 text-base font-semibold text-[#7fc8a0]">
                  +{gain.value}
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#8a8a96]">Рекорд</p>
            <p
              className={`text-xl font-bold leading-tight tabular-nums ${
                newRecord ? 'text-[#7fc8a0]' : 'text-[#b0b0bb]'
              }`}
            >
              {shownBest}
            </p>
          </div>
        </div>
      </header>

      {saveError && (
        <div className="mt-4 rounded-xl border border-[#e5786f]/35 bg-[#e5786f]/10 px-4 py-3 text-center text-sm text-[#e5786f]">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="mt-5 flex flex-col gap-6 md:flex-row md:gap-8">
        <div className="space-y-4 md:w-72 md:shrink-0">
          {phase === 'question' && current && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <p className="text-sm text-[#8a8a96]">
                Переведите слово — за верный ответ получите 3 фигуры
              </p>
              <div className="card flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="break-words text-2xl font-bold">{current.word}</p>
                  {current.transcription && (
                    <p className="mt-0.5 text-sm text-[#8a8a96]">{current.transcription}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => speak(current.word)}
                  className="icon-btn shrink-0 text-[#8ea2ff]!"
                  title="Озвучить"
                  aria-label="Озвучить"
                >
                  <SpeakerIcon />
                </button>
              </div>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Введите перевод"
                className={`field min-h-[3.25rem]! text-base ${
                  attempt === 2 ? 'border-[#e5786f]!' : ''
                }`}
              />

              {attempt === 2 && (
                <p className="text-sm text-[#e5786f]">Неверно. Попробуйте ещё раз.</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={failWord} className="btn btn-lg btn-danger">
                  Не знаю
                </button>
                <button type="submit" disabled={!input.trim()} className="btn btn-lg btn-primary">
                  Проверить
                </button>
              </div>
            </form>
          )}

          {phase === 'revealed' && current && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="card p-4">
                <p className="text-sm text-[#8a8a96]">{current.word}</p>
                <p className="mt-1 text-sm text-[#8a8a96]">Правильный ответ:</p>
                <p className="mt-0.5 text-2xl font-bold text-[#8ea2ff]">{current.translation}</p>
              </div>
              <button type="submit" autoFocus className="btn btn-lg btn-block btn-primary">
                Дальше
              </button>
            </form>
          )}

          {phase === 'placing' && (
            <>
              {lastAnswer && (
                <div className="rounded-[14px] bg-[#7fc8a0]/10 p-4">
                  <p className="flex items-center gap-2 font-semibold text-[#7fc8a0]">
                    <Icon name="check" size={18} />
                    Верно!
                  </p>
                  <p className="mt-2 text-sm text-[#8a8a96]">
                    {lastAnswer.word} — <span className="font-semibold text-[#ececf1]">{lastAnswer.translation}</span>
                  </p>
                </div>
              )}
              <p className="text-sm text-[#b0b0bb]">
                Перетащите фигуры на поле. Осталось: {pieces.length}
              </p>
            </>
          )}
        </div>

        <div className="mx-auto w-full max-w-[420px] md:mx-0">
          <div className="card p-1.5">
            <div ref={boardRef} className="grid grid-cols-8 select-none">
              {board.map((row, r) =>
                row.map((value, c) => {
                  let cls = value !== 0 ? COLORS[value] : 'bg-[#1b1b21]'
                  if (previewCells.has(`${r},${c}`)) cls = 'bg-[#8ea2ff]/50'
                  return (
                    <div key={`${r}-${c}`} className="aspect-square p-[2px]">
                      <div className={`h-full w-full rounded-md transition-colors ${cls}`} />
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {phase === 'placing' && (
            <div className="mt-5 flex min-h-[7.5rem] items-center justify-center gap-3">
              {pieces.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onPointerDown={e => startDrag(e, p)}
                  onContextMenu={e => e.preventDefault()}
                  className={`touch-none select-none rounded-[14px] border border-[#2c2c34] bg-[#15151a] p-2 transition ${
                    drag?.pieceId === p.id ? 'opacity-30' : 'hover:border-[#8ea2ff]'
                  }`}
                >
                  <div
                    className="grid gap-0.5"
                    style={{ gridTemplateColumns: `repeat(${p.w}, 22px)` }}
                  >
                    {Array.from({ length: p.h * p.w }, (_, i) => {
                      const r = Math.floor(i / p.w)
                      const c = i % p.w
                      const filled = p.cells.some(([dr, dc]) => dr === r && dc === c)
                      return (
                        <div
                          key={i}
                          className={`h-[22px] w-[22px] rounded ${filled ? COLORS[p.color] : ''}`}
                        />
                      )
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {drag && draggedPiece && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.left,
            top: drag.top,
            width: draggedPiece.w * drag.cell,
            height: draggedPiece.h * drag.cell,
          }}
        >
          <div
            className="grid h-full w-full"
            style={{
              gridTemplateColumns: `repeat(${draggedPiece.w}, 1fr)`,
              gridTemplateRows: `repeat(${draggedPiece.h}, 1fr)`,
            }}
          >
            {Array.from({ length: draggedPiece.h * draggedPiece.w }, (_, i) => {
              const r = Math.floor(i / draggedPiece.w)
              const c = i % draggedPiece.w
              const filled = draggedPiece.cells.some(([dr, dc]) => dr === r && dc === c)
              return (
                <div key={i} className="p-[2px]">
                  {filled && (
                    <div className={`h-full w-full rounded-md opacity-90 ${COLORS[draggedPiece.color]}`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const SCREEN =
  'mx-auto flex w-full max-w-4xl flex-col px-4 min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]'

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
