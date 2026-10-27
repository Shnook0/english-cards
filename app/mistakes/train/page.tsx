'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Card } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { fetchCards, fetchFolders } from '@/lib/offline/repo'

export default function TrainMistakesPage() {
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

    setCards(await fetchCards({ userId: user.id, mistakes: true, order: 'wrong_desc' }))
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  if (authLoading || loading) {
    return <div className="min-h-screen bg-[#0d0d10] text-[#ececf1] flex items-center justify-center">Загрузка тренировки...</div>
  }

  return (
    <TrainSession
      initialCards={cards}
      mode="mistakes"
      userId={user!.id}
      learnedFolderId={learnedFolderId}
      onExit={() => router.push('/mistakes')}
    />
  )
}