'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { fetchCards, fetchFolders } from '@/lib/offline/repo'

export default function TrainFavoritesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()
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

    setCards(await fetchCards({ userId: user.id, favorite: true, order: 'created_desc' }))
    setLoading(false)
  }, [user])

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
      mode="favorites"
      userId={user!.id}
      learnedFolderId={learnedFolderId}
      onExit={() => router.push('/favorites')}
    />
  )
}