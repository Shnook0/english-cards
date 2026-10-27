'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'
import TrainSession from '@/components/TrainSession'
import { fetchCards, fetchFolders } from '@/lib/offline/repo'

export default function TrainMistakesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
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
    return <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">Загрузка тренировки...</div>
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