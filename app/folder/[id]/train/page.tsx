'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Card, Folder } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { buildStudyQueue } from '@/lib/study'
import { fetchCards, fetchFolder, fetchFolders } from '@/lib/offline/repo'

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

  const load = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)
    try {
      const f = await fetchFolder(folderId)
      if (!f) {
        setError('Папка не найдена')
        setLoading(false)
        return
      }
      setFolder(f)

      const learnedFolders = await fetchFolders(user.id, 'learned')
      if (learnedFolders[0]) setLearnedFolderId(learnedFolders[0].id)

      const list =
        f.type === 'learned'
          ? await fetchCards({ userId: user.id, learned: true, order: 'learned_asc' })
          : await fetchCards({ userId: user.id, folderId, order: 'created_asc' })

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
        setCards(list)
      } else {
        // Обычные папки: вся папка в умном порядке
        // (новые строго по порядку папки → повтор → ошибки → остальные невыученные → выученные)
        setCards(buildStudyQueue(list))
      }
    } catch {
      setError('Не удалось инициализировать тренировку')
    } finally {
      setLoading(false)
    }
  }, [user, folderId])

  useEffect(() => {
    if (user && folderId) void load()
  }, [user, folderId, load])

  const handleExit = () => router.push(`/folder/${folderId}`)

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">
        Загрузка тренировки...
      </div>
    )
  }

  if (error || !folder) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex flex-col items-center justify-center p-4">
        <p className="mb-4 text-[#bb7464]">{error || 'Ошибка'}</p>
        <button onClick={handleExit} className="text-sm text-[#c9a96e] hover:underline">
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