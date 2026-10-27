'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/types/database'
import { StudyGameProps, shuffle } from '@/lib/study'
import { fetchBestTime, formatTime, saveBestTime } from '@/lib/records'

const ROUND_SIZE = 6

type Props = StudyGameProps & { recordScope: string }

type Tile = { id: string; cardId: string; kind: 'en' | 'ru'; text: string }

function makeTiles(cards: Card[]): Tile[] {
  const tiles: Tile[] = []
  for (const c of cards) {
    tiles.push({ id: `${c.id}-en`, cardId: c.id, kind: 'en', text: c.word })
    tiles.push({ id: `${c.id}-ru`, cardId: c.id, kind: 'ru', text: c.translation })
  }
  return shuffle(tiles)
}

export default function MatchGame({
  cards,
  recordScope,
  recordResult,
  onNextRound,
  onExit,
}: Props) {
  const [roundCards, setRoundCards] = useState<Card[]>(() => cards.slice(0, ROUND_SIZE))
  const [rest, setRest] = useState<Card[]>(() => cards.slice(ROUND_SIZE))
  const [tiles, setTiles] = useState<Tile[]>(() => makeTiles(cards.slice(0, ROUND_SIZE)))
  const [matched, setMatched] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [wrongPair, setWrongPair] = useState<string[]>([])
  const [missed, setMissed] = useState<string[]>([])
  const [phase, setPhase] = useState<'playing' | 'roundDone' | 'finished'>(
    cards.length === 0 ? 'finished' : 'playing'
  )
  const [roundNo, setRoundNo] = useState(1)
  const [elapsed, setElapsed] = useState(0)
  const [lastTime, setLastTime] = useState(0)
  const [roundMisses, setRoundMisses] = useState(0)
  const [saveError, setSaveError] = useState(false)
  const [best, setBest] = useState<number | null>(null)
  const [isRecord, setIsRecord] = useState(false)

  const startRef = useRef(0)
  const elapsedRef = useRef(0)
  const lockedRef = useRef(false)

  // Загружаем текущий рекорд
  useEffect(() => {
    fetchBestTime(recordScope).then(setBest)
  }, [recordScope])

  useEffect(() => {
    if (phase !== 'playing') return
    startRef.current = Date.now()
    elapsedRef.current = 0
    const id = setInterval(() => {
      const value = (Date.now() - startRef.current) / 1000
      elapsedRef.current = value
      setElapsed(value)
    }, 100)
    return () => clearInterval(id)
  }, [phase, roundNo])

  const report = (card: Card, correct: boolean) => {
    recordResult(card, correct).then(ok => {
      if (!ok) setSaveError(true)
    })
  }

  // Рекорд считается только за полный раунд (6 пар)
  const checkRecord = (seconds: number) => {
    if (roundCards.length !== ROUND_SIZE) return
    const time = Math.round(seconds * 10) / 10
    if (best !== null && time >= best) return

    saveBestTime(recordScope, time).then(res => {
      if (res === 'saved') {
        setIsRecord(true)
        setBest(time)
      } else if (res === 'error') {
        setSaveError(true)
      } else {
        fetchBestTime(recordScope).then(setBest)
      }
    })
  }

  const handleTile = (tile: Tile) => {
    if (phase !== 'playing' || lockedRef.current) return
    if (matched.includes(tile.id)) return

    if (selected === null) {
      setSelected(tile.id)
      return
    }
    if (selected === tile.id) {
      setSelected(null)
      return
    }

    const first = tiles.find(t => t.id === selected)
    if (!first || first.kind === tile.kind) {
      setSelected(tile.id)
      return
    }

    if (first.cardId === tile.cardId) {
      // Верная пара
      const newMatched = [...matched, first.id, tile.id]
      setMatched(newMatched)
      setSelected(null)

      if (!missed.includes(first.cardId)) {
        const card = roundCards.find(c => c.id === first.cardId)
        if (card) report(card, true)
      }

      if (newMatched.length === tiles.length) {
        const seconds = elapsedRef.current
        setLastTime(seconds)
        setPhase('roundDone')
        checkRecord(seconds)
      }
    } else {
      // Ошибка: «промахнувшимся» считается слово первой выбранной плитки
      lockedRef.current = true
      setWrongPair([first.id, tile.id])
      setRoundMisses(n => n + 1)
      setSelected(null)

      if (!missed.includes(first.cardId)) {
        setMissed([...missed, first.cardId])
        const card = roundCards.find(c => c.id === first.cardId)
        if (card) report(card, false)
      }

      setTimeout(() => {
        setWrongPair([])
        lockedRef.current = false
      }, 500)
    }
  }

  const hasMore = roundCards.some(c => missed.includes(c.id)) || rest.length > 0
  const fullRound = roundCards.length === ROUND_SIZE

  const startNextRound = () => {
    // Слова с ошибками переходят в следующий раунд
    const carry = roundCards.filter(c => missed.includes(c.id))
    const pool = [...carry, ...rest]
    if (pool.length === 0) {
      setPhase('finished')
      return
    }
    const next = pool.slice(0, ROUND_SIZE)
    setRoundCards(next)
    setRest(pool.slice(ROUND_SIZE))
    setTiles(makeTiles(next))
    setMatched([])
    setMissed([])
    setSelected(null)
    setWrongPair([])
    setRoundMisses(0)
    setIsRecord(false)
    setElapsed(0)
    setRoundNo(n => n + 1)
    setPhase('playing')
  }

  if (phase === 'finished') {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24242b] bg-[#15151a] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">
            {cards.length === 0 ? 'Нет слов для подбора' : 'Сессия завершена'}
          </h2>
          {cards.length > 0 && (
            <p className="text-sm text-[#8a8a96] mb-6">Раундов сыграно: {roundNo}</p>
          )}
          {cards.length === 0 && <div className="mb-6" />}
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
              onClick={onExit}
              className="w-full rounded-lg border border-[#2c2c34] py-3 font-medium hover:border-[#8ea2ff] transition"
            >
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'roundDone') {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[#24242b] bg-[#15151a] p-8 text-center shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">Раунд {roundNo} завершён</h2>
          <p className="text-3xl font-bold text-[#8ea2ff] mb-2">{formatTime(lastTime)} с</p>

          {fullRound ? (
            isRecord ? (
              <p className="text-[#7fc8a0] font-semibold mb-2">Новый рекорд! 🏆</p>
            ) : (
              best !== null && (
                <p className="text-sm text-[#8a8a96] mb-2">Рекорд: {formatTime(best)} с</p>
              )
            )
          ) : (
            <p className="text-xs text-[#8a8a96] mb-2">
              Рекорд считается только за полный раунд из 6 пар
            </p>
          )}

          <p className="text-sm text-[#8a8a96] mb-6">Ошибок: {roundMisses}</p>
          <button
            onClick={startNextRound}
            className="w-full rounded-lg bg-[#8ea2ff] py-3 font-medium text-[#0d0d10] hover:bg-[#7186e8] transition"
          >
            {hasMore ? 'Следующий раунд' : 'Завершить'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] p-4 md:p-8 max-w-5xl mx-auto">
      {saveError && (
        <div className="mb-4 rounded-lg bg-[#e5786f]/20 border border-[#e5786f] p-3 text-sm text-center">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <div className="grid grid-cols-3 items-center mb-6 text-sm text-[#8a8a96]">
        <span className="font-medium text-[#ececf1]">Подбор · раунд {roundNo}</span>
        <div className="text-center">
          <div className="text-lg font-bold text-[#ececf1]">{formatTime(elapsed)}</div>
          {best !== null && (
            <div className="text-xs text-[#8a8a96]">🏆 {formatTime(best)}</div>
          )}
        </div>
        <button onClick={onExit} className="text-right hover:text-[#ececf1] transition font-medium">
          Выйти
        </button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        {tiles.map(t => {
          const isMatched = matched.includes(t.id)
          const isWrong = wrongPair.includes(t.id)
          const isSelected = selected === t.id

          let state = 'border-[#2c2c34] bg-[#15151a] hover:border-[#44444e]'
          if (isWrong) state = 'border-[#e5786f] bg-[#e5786f]/20'
          else if (isSelected) state = 'border-[#8ea2ff] bg-[#8ea2ff]/20'

          return (
            <button
              key={t.id}
              onClick={() => handleTile(t)}
              className={`min-h-[96px] md:min-h-[120px] rounded-xl border p-3 text-center text-sm md:text-base font-medium transition select-none ${state} ${
                isMatched ? 'invisible' : ''
              }`}
            >
              {t.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}