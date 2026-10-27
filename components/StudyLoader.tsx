'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card } from '@/types/database'
import { buildStudyQueue, patchCorrect, patchWrong } from '@/lib/study'
import { fetchCards, fetchFolder, saveCardAnswer } from '@/lib/offline/repo'
import MatchGame from '@/components/MatchGame'
import DictationGame from '@/components/DictationGame'
import BlocksGame from '@/components/BlocksGame'
import LearnGame from '@/components/LearnGame'

type Props = {
  kind: 'folder' | 'favorites' | 'mistakes'
  folderId?: string
  mode: string
  exitHref: string
}

export default function StudyLoader({ kind, folderId, mode, exitHref }: Props) {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

  const [queue, setQueue] = useState<Card[]>([])
  const [roundKey, setRoundKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const latestRef = useRef<Map<string, Card>>(new Map())
  const isLevelRef = useRef(false)

  // Ключ, под которым хранится рекорд «Подбора»
  const recordScope = kind === 'folder' ? `folder:${folderId}` : kind

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)
    try {
      let list: Card[] = []
      let level = false

      if (kind === 'folder') {
        if (!folderId) {
          setError('Папка не найдена')
          return
        }
        const f = await fetchFolder(folderId)
        if (!f) {
          setError('Папка не найдена')
          return
        }
        if (f.type === 'learned') {
          setError('Для папки «Выученные» эти режимы недоступны')
          return
        }
        level = f.type === 'level'
        list = await fetchCards({ userId: user.id, folderId })
      } else if (kind === 'favorites') {
        list = await fetchCards({ userId: user.id, favorite: true })
      } else {
        list = await fetchCards({ userId: user.id, mistakes: true })
      }

      isLevelRef.current = level
      latestRef.current = new Map(list.map(c => [c.id, c]))
      setQueue(buildStudyQueue(list))
      setRoundKey(k => k + 1)
    } catch {
      setError('Не удалось загрузить слова')
    } finally {
      setLoading(false)
    }
  }, [user, kind, folderId])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  // Записывает результат ответа в карточку (по тем же правилам, что и обычная тренировка)
  const recordResult = useCallback(async (card: Card, correct: boolean) => {
    const current = latestRef.current.get(card.id) ?? card
    const patch = correct
      ? patchCorrect(current, isLevelRef.current)
      : patchWrong(current, isLevelRef.current)
    latestRef.current.set(card.id, { ...current, ...patch } as Card)
    return saveCardAnswer(current, correct, isLevelRef.current)
  }, [])

  // Новая очередь из всей папки по актуальным данным (когда слова закончились)
  const getMore = useCallback(() => {
    return buildStudyQueue(Array.from(latestRef.current.values()))
  }, [])

  const handleExit = () => router.push(exitHref)

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#e5786f]">{error}</p>
        <Link href={exitHref} className="text-sm text-[#8ea2ff] hover:underline">← Назад</Link>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex flex-col items-center justify-center p-4 text-center">
        <p className="mb-2 text-lg font-semibold">В этой папке нет слов</p>
        <p className="mb-6 text-sm text-[#8a8a96]">Добавьте карточки и возвращайтесь.</p>
        <Link href={exitHref} className="text-sm text-[#8ea2ff] hover:underline">← Назад</Link>
      </div>
    )
  }

  if (mode === 'match') {
    return (
      <MatchGame
        key={roundKey}
        cards={queue}
        recordScope={recordScope}
        recordResult={recordResult}
        getMore={getMore}
        onNextRound={load}
        onExit={handleExit}
      />
    )
  }

  if (mode === 'dictation') {
    return (
      <DictationGame
        key={roundKey}
        cards={queue}
        recordResult={recordResult}
        getMore={getMore}
        onNextRound={load}
        onExit={handleExit}
      />
    )
  }

  if (mode === 'blocks') {
    return (
      <BlocksGame
        key={roundKey}
        cards={queue}
        recordResult={recordResult}
        getMore={getMore}
        onNextRound={load}
        onExit={handleExit}
      />
    )
  }

  if (mode === 'learn') {
    return (
      <LearnGame
        key={roundKey}
        cards={queue}
        recordResult={recordResult}
        getMore={getMore}
        onNextRound={load}
        onExit={handleExit}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex flex-col items-center justify-center p-4">
      <p className="mb-4 text-[#e5786f]">Неизвестный режим</p>
      <Link href={exitHref} className="text-sm text-[#8ea2ff] hover:underline">← Назад</Link>
    </div>
  )
}

// конец файла