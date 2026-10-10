'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card, Folder } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { buildStudyQueue } from '@/lib/study'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function TrainFolderPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const folderId = params.id as string

  const [folder, setFolder] = useState<Folder | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [learnedFolderId, setLearnedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (user && folderId) load()
  }, [user, folderId])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: f, error: fErr } = await supabase
        .from('folders')
        .select('*')
        .eq('id', folderId)
        .single()
      if (fErr || !f) {
        setError('Папка не найдена')
        setLoading(false)
        return
      }
      setFolder(f as Folder)

      const { data: lf } = await supabase
        .from('folders')
        .select('id')
        .eq('user_id', user!.id)
        .eq('type', 'learned')
        .single()
      if (lf) setLearnedFolderId(lf.id)

      const { data: all, error: cErr } = await supabase
        .from('cards')
        .select('*')
        .eq('folder_id', folderId)
      if (cErr) {
        setError('Ошибка загрузки карточек')
        setLoading(false)
        return
      }

      const list = (all ?? []) as Card[]

      if (f.type === 'level') {
        // Особая сортировка для уровня:
        // 1) новые (не видел), 2) с ошибками, 3) уже выученные (когда придёт их время)
        const now = new Date()
        const fresh = list.filter(c => !c.learned_at && (c.wrong_count || 0) === 0)
        const missed = list.filter(c => !c.learned_at && (c.wrong_count || 0) > 0)
        const learnedDue = list.filter(
          c => c.learned_at && new Date(c.next_review_at) <= now
        )
        const queue = [
          ...shuffle(fresh),
          ...shuffle(missed),
          ...shuffle(learnedDue),
        ]
        setCards(queue)
      } else if (f.type === 'learned') {
        const { data } = await supabase
          .from('cards')
          .select('*')
          .not('learned_at', 'is', null)
          .order('learned_at', { ascending: true })
        setCards((data ?? []) as Card[])
      } else {
        // Обычные папки: вся папка в умном порядке
        // (ошибки → новые вперемешку со словами на повтор → остальные невыученные → выученные)
        setCards(buildStudyQueue(list))
      }
    } catch {
      setError('Не удалось инициализировать тренировку')
    } finally {
      setLoading(false)
    }
  }

  const handleExit = () => router.push(`/folder/${folderId}`)

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка тренировки...
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#a04a4a]">{error || 'Ошибка'}</p>
        <button onClick={handleExit} className="text-sm text-[#6c7cff] hover:underline">
          ← Вернуться в папку
        </button>
      </div>
    )
  }

  const mode: 'folder' | 'learned' | 'level' =
    folder.type === 'level' ? 'level' :
    folder.type === 'learned' ? 'learned' : 'folder'

  return (
    <TrainSession
      initialCards={cards}
      mode={mode}
      userId={user!.id}
      learnedFolderId={learnedFolderId}
      onExit={handleExit}
    />
  )
}

// конец файла