'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'
import {
  SESSION_LIMIT,
  buildStudyQueue,
  patchCorrect,
  patchWrong,
  saveCardPatch,
} from '@/lib/study'
import MatchGame from '@/components/MatchGame'
import DictationGame from '@/components/DictationGame'
import BlocksGame from '@/components/BlocksGame'

type Props = {
  kind: 'folder' | 'favorites' | 'mistakes'
  folderId?: string
  mode: string
  exitHref: string
}

export default function StudyLoader({ kind, folderId, mode, exitHref }: Props) {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

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

  useEffect(() => {
    if (user) load()
  }, [user, kind, folderId])

  const load = async () => {
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
        const { data: f, error: fErr } = await supabase
          .from('folders')
          .select('*')
          .eq('id', folderId)
          .single()
        if (fErr || !f) {
          setError('Папка не найдена')
          return
        }
        if (f.type === 'learned') {
          setError('Для папки «Выученные» эти режимы недоступны')
          return
        }
        level = f.type === 'level'

        const { data, error: cErr } = await supabase
          .from('cards')
          .select('*')
          .eq('folder_id', folderId)
        if (cErr) throw cErr
        list = (data ?? []) as Card[]
      } else if (kind === 'favorites') {
        const { data, error: cErr } = await supabase
          .from('cards')
          .select('*')
          .eq('user_id', user!.id)
          .eq('is_favorite', true)
        if (cErr) throw cErr
        list = (data ?? []) as Card[]
      } else {
        const { data, error: cErr } = await supabase
          .from('cards')
          .select('*')
          .eq('user_id', user!.id)
          .gte('wrong_count', 2)
        if (cErr) throw cErr
        list = (data ?? []) as Card[]
      }

      isLevelRef.current = level
      latestRef.current = new Map(list.map(c => [c.id, c]))
      setQueue(buildStudyQueue(list, mode === 'blocks' ? undefined : SESSION_LIMIT))
      setRoundKey(k => k + 1)
    } catch {
      setError('Не удалось загрузить слова')
    } finally {
      setLoading(false)
    }
  }

  // Записывает результат ответа в карточку (по тем же правилам, что и обычная тренировка)
  const recordResult = useCallback(async (card: Card, correct: boolean) => {
    const current = latestRef.current.get(card.id) ?? card
    const patch = correct
      ? patchCorrect(current, isLevelRef.current)
      : patchWrong(current, isLevelRef.current)
    latestRef.current.set(card.id, { ...current, ...patch } as Card)
    return saveCardPatch(card.id, patch)
  }, [])

  const handleExit = () => router.push(exitHref)

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#a04a4a]">{error}</p>
        <Link href={exitHref} className="text-sm text-[#6c7cff] hover:underline">← Назад</Link>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4 text-center">
        <p className="mb-2 text-lg font-semibold">Сейчас нет слов для этого режима</p>
        <p className="mb-6 text-sm text-[#8b90a0]">
          Все слова выучены или ждут своего срока повторения.
        </p>
        <Link href={exitHref} className="text-sm text-[#6c7cff] hover:underline">← Назад</Link>
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
        onNextRound={load}
        onExit={handleExit}
      />
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4">
      <p className="mb-4 text-[#a04a4a]">Неизвестный режим</p>
      <Link href={exitHref} className="text-sm text-[#6c7cff] hover:underline">← Назад</Link>
    </div>
  )
}