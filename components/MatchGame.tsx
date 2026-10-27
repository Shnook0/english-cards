'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/types/database'
import { StudyGameProps, shuffle } from '@/lib/study'
import { fetchBestTime, formatTime, saveBestTime } from '@/lib/records'
import Icon from '@/components/ui/Icon'

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
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in mx-auto w-full max-w-xl p-6 text-center sm:p-8">
          <h2 className="text-xl">
            {cards.length === 0 ? 'Нет слов для подбора' : 'Подбор завершён'}
          </h2>
          {cards.length > 0 && (
            <>
              <p className="mt-5 text-5xl font-bold leading-none text-[#8ea2ff]">{roundNo}</p>
              <p className="mt-2 text-sm text-[#8a8a96]">раундов сыграно</p>
            </>
          )}
          <div className="mt-7 flex flex-col gap-3">
            {cards.length > 0 && (
              <button onClick={onNextRound} className="btn btn-primary btn-lg btn-block">
                Ещё раунд
              </button>
            )}
            <button onClick={onExit} className="btn btn-secondary btn-lg btn-block">
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'roundDone') {
    return (
      <div className={`${SCREEN} justify-center py-8`}>
        <div className="card page-in mx-auto w-full max-w-xl p-6 text-center sm:p-8">
          <h2 className="text-xl">Раунд {roundNo} завершён</h2>
          <p className="mt-5 text-5xl font-bold leading-none tabular-nums text-[#8ea2ff]">
            {formatTime(lastTime)}
            <span className="text-2xl font-semibold text-[#6b6b76]"> с</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {fullRound ? (
              isRecord ? (
                <span className="chip chip-success">Новый рекорд!</span>
              ) : (
                best !== null && <span className="chip">Рекорд: {formatTime(best)} с</span>
              )
            ) : null}
            <span className={`chip ${roundMisses > 0 ? 'chip-danger' : ''}`}>
              Ошибок: {roundMisses}
            </span>
          </div>

          {!fullRound && (
            <p className="mt-3 text-sm text-[#8a8a96]">
              Рекорд считается только за полный раунд из 6 пар
            </p>
          )}

          <button onClick={startNextRound} className="btn btn-primary btn-lg btn-block mt-7">
            {hasMore ? 'Следующий раунд' : 'Завершить'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`${SCREEN} pb-4`}>
      <header className="grid grid-cols-3 items-center gap-2 pt-2">
        <button onClick={onExit} className="btn btn-ghost btn-sm -ml-3 justify-self-start">
          <Icon name="arrowLeft" size={16} />
          Выйти
        </button>
        <div className="text-center">
          <div className="text-xl font-bold tabular-nums text-[#ececf1]">{formatTime(elapsed)}</div>
          {best !== null && (
            <div className="text-xs tabular-nums text-[#8a8a96]">рекорд {formatTime(best)}</div>
          )}
        </div>
        <span className="text-right text-sm font-medium text-[#b0b0bb]">Раунд {roundNo}</span>
      </header>

      {saveError && (
        <div className="mt-4 rounded-xl border border-[#e5786f]/35 bg-[#e5786f]/10 px-4 py-3 text-center text-sm text-[#e5786f]">
          Не удалось сохранить часть результатов. Проверьте интернет.
        </div>
      )}

      <main className="flex flex-1 flex-col justify-center py-6">
        <p className="mb-4 text-center text-sm text-[#8a8a96]">
          Нажмите на слово, затем на его перевод — пара исчезнет
        </p>

        <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
          {tiles.map(t => {
            const isMatched = matched.includes(t.id)
            const isWrong = wrongPair.includes(t.id)
            const isSelected = selected === t.id

            let state = 'border-[#2c2c34] bg-[#15151a] text-[#ececf1] hover:border-[#44444e]'
            if (isWrong) state = 'border-[#e5786f] bg-[#e5786f]/15 text-[#e5786f]'
            else if (isSelected) state = 'border-[#8ea2ff] bg-[#8ea2ff]/15 text-[#ececf1]'

            return (
              <button
                key={t.id}
                onClick={() => handleTile(t)}
                className={`flex min-h-[92px] select-none items-center justify-center break-words rounded-[14px] border p-3 text-center text-sm font-medium leading-snug transition active:scale-[0.97] md:min-h-[112px] md:text-base ${state} ${
                  isMatched ? 'invisible' : ''
                }`}
              >
                {t.text}
              </button>
            )
          })}
        </div>
      </main>
    </div>
  )
}

const SCREEN =
  'mx-auto flex w-full max-w-2xl flex-col px-4 min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))]'
