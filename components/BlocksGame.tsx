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
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24242b] bg-[#15151a] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {cards.length === 0 ? 'Нет слов для игры' : 'Слова закончились'}
          </h2>
          {cards.length > 0 && (
            <>
              <p className="text-sm text-[#8a8a96] mb-1">
                Слов пройдено: {doneCount} · Очки: {score}
              </p>
              <p className="text-sm text-[#8a8a96] mb-2">🏆 Рекорд: {shownBest}</p>
              {newRecord && (
                <p className="text-[#7fc8a0] font-semibold mb-2">Новый рекорд!</p>
              )}
            </>
          )}
          <div className="mb-4" />
          <div className="flex flex-col gap-3">
            {cards.length > 0 && (
              <button
                onClick={onNextRound}
                className="w-full rounded-lg bg-[#8ea2ff] py-3 font-medium text-[#0d0d10] hover:bg-[#7186e8] transition"
              >
                Ещё раунд
              </button>
            )}
            <button
              onClick={handleExit}
              className="w-full rounded-lg border border-[#2c2c34] py-3 font-medium hover:border-[#8ea2ff] transition"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'over') {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24242b] bg-[#15151a] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">Игра окончена</h2>
          <p className="text-4xl font-bold text-[#8ea2ff] mb-2">{score}</p>
          {newRecord && <p className="text-[#7fc8a0] font-semibold mb-2">Новый рекорд! 🏆</p>}
          <p className="text-sm text-[#8a8a96] mb-1">🏆 Рекорд: {shownBest}</p>
          <p className="text-sm text-[#8a8a96] mb-6">Слов пройдено: {doneCount}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={restartGame}
              className="w-full rounded-lg bg-[#8ea2ff] py-3 font-medium text-[#0d0d10] hover:bg-[#7186e8] transition"
            >
              Играть снова
            </button>
            <button
              onClick={handleExit}
              className="w-full rounded-lg border border-[#2c2c34] py-3 font-medium hover:border-[#8ea2ff] transition"
            >
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
    <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] p-4 md:p-8 max-w-4xl mx-auto">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#e5786f]/20 border border-[#e5786f] p-3 text-sm text-center">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="flex items-center justify-between mb-4 text-sm text-[#8a8a96]">
        <span className="font-medium text-[#ececf1]">Блоки</span>
        <span>
          Слов: <b className="text-[#ececf1]">{doneCount}</b>
        </span>
        <button onClick={handleExit} className="hover:text-[#ececf1] transition font-medium">
          Выйти
        </button>
      </div>

      <div className="mb-6 flex items-end justify-between rounded-xl border border-[#24242b] bg-[#15151a] px-4 py-3">
        <div>
          <p className="text-xs text-[#8a8a96]">Очки</p>
          <p className="text-3xl font-bold">
            {score}
            {gain && (
              <span key={gain.key} className="ml-2 text-base font-semibold text-[#7fc8a0]">
                +{gain.value}
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#8a8a96]">🏆 Рекорд</p>
          <p className={`text-xl font-bold ${newRecord ? 'text-[#7fc8a0]' : ''}`}>{shownBest}</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <div className="md:w-72 space-y-4">
          {phase === 'question' && current && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl border border-[#24242b] bg-[#15151a] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-2xl font-bold">{current.word}</p>
                    {current.transcription && (
                      <p className="text-sm text-[#8a8a96]">{current.transcription}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => speak(current.word)}
                    className="rounded-lg bg-[#0d0d10] px-2.5 py-1.5 text-[#8ea2ff] hover:bg-[#1b1b21] transition"
                    title="Озвучить"
                  >
                    🔊
                  </button>
                </div>
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
                className={`w-full rounded-lg border bg-[#15151a] p-3 text-[#ececf1] outline-none ${
                  attempt === 2 ? 'border-[#e5786f]' : 'border-[#2c2c34] focus:border-[#8ea2ff]'
                }`}
              />

              {attempt === 2 && (
                <p className="text-sm text-[#e5786f]">Неверно. Попробуйте ещё раз.</p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={failWord}
                  className="rounded-xl border border-[#2c2c34] px-4 py-3 text-sm font-medium hover:border-[#e5786f] hover:text-[#e5786f] transition"
                >
                  Не знаю
                </button>
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex-1 rounded-xl bg-[#8ea2ff] py-3 font-semibold text-[#0d0d10] hover:bg-[#7186e8] transition disabled:opacity-50"
                >
                  Отправить
                </button>
              </div>
            </form>
          )}

          {phase === 'revealed' && current && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl border border-[#24242b] bg-[#15151a] p-4">
                <p className="text-sm text-[#8a8a96] mb-1">{current.word}</p>
                <p className="text-sm text-[#8a8a96] mb-1">Правильный ответ:</p>
                <p className="text-2xl font-bold text-[#8ea2ff]">{current.translation}</p>
              </div>
              <button
                type="submit"
                autoFocus
                className="w-full rounded-xl bg-[#8ea2ff] py-3 font-semibold text-[#0d0d10] hover:bg-[#7186e8] transition"
              >
                Дальше
              </button>
            </form>
          )}

          {phase === 'placing' && (
            <>
              {lastAnswer && (
                <div className="rounded-xl border border-[#5fae84]/60 bg-[#5fae84]/10 p-4">
                  <p className="font-semibold text-[#7fc8a0]">Ты правильно ответил! ✓</p>
                  <p className="mt-2 text-sm text-[#8a8a96]">{lastAnswer.word}</p>
                  <p className="text-sm text-[#8a8a96]">Правильный ответ:</p>
                  <p className="text-xl font-bold text-[#ececf1]">{lastAnswer.translation}</p>
                </div>
              )}
              <p className="text-sm text-[#8a8a96]">
                Перетащите фигуры на поле. Осталось: {pieces.length}
              </p>
            </>
          )}
        </div>

        <div className="w-full max-w-[420px] mx-auto md:mx-0">
          <div ref={boardRef} className="grid grid-cols-8 select-none">
            {board.map((row, r) =>
              row.map((value, c) => {
                let cls = value !== 0 ? COLORS[value] : 'bg-[#15151a]'
                if (previewCells.has(`${r},${c}`)) cls = 'bg-[#8ea2ff]/50'
                return (
                  <div key={`${r}-${c}`} className="aspect-square p-[2px]">
                    <div className={`h-full w-full rounded-md transition-colors ${cls}`} />
                  </div>
                )
              })
            )}
          </div>

          {phase === 'placing' && (
            <div className="mt-6 flex min-h-[7.5rem] items-center justify-center gap-3">
              {pieces.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onPointerDown={e => startDrag(e, p)}
                  onContextMenu={e => e.preventDefault()}
                  className={`touch-none select-none rounded-xl border border-[#2c2c34] bg-[#15151a] p-2 transition ${
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

