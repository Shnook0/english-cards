'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { isHard } from '@/lib/hard'
import { fetchCards, fetchFolders } from '@/lib/offline/repo'

export default function TrainHardPage() {
  const { user, loading: authLoading } = useAuth()
  const params = useParams()
  const router = useOfflineRouter()
  const folderId = params.id as string

  const [cards, setCards] = useState<Card[]>([])
  const [learnedFolderId, setLearnedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return

    setLoading(true)
    const learnedFolders = await fetchFolders(user.id, 'learned')
    if (learnedFolders[0]) setLearnedFolderId(learnedFolders[0].id)

    const all = await fetchCards({ userId: user.id, folderId, order: 'wrong_desc' })
    setCards(all.filter(isHard))
    setLoading(false)
  }, [user, folderId])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Готовим тренировку…</span>
      </div>
    )
  }

  return (
    <TrainSession
      initialCards={cards}
      mode="mistakes"
      userId={user!.id}
      learnedFolderId={learnedFolderId}
      onExit={() => router.push(`/folder/${folderId}/hard`)}
    />
  )
}
