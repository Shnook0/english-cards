'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/types/database'
import TrainSession from '@/components/TrainSession'

export default function TrainFavoritesPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [cards, setCards] = useState<Card[]>([])
  const [learnedFolderId, setLearnedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) load()
  }, [user])

  const load = async () => {
    setLoading(true)
    const { data: lf } = await supabase
      .from('folders').select('id').eq('user_id', user!.id).eq('type', 'learned').single()
    if (lf) setLearnedFolderId(lf.id)

    const { data } = await supabase
      .from('cards')
      .select('*')
      .eq('is_favorite', true)
      .order('created_at', { ascending: false })
    setCards((data ?? []) as Card[])
    setLoading(false)
  }

  if (authLoading || loading) {
    return <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">Загрузка тренировки...</div>
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