'use client'

import { useEffect, useState } from 'react'
import { fetchBestTime, formatTime } from '@/lib/records'

export default function MatchRecord({ scope }: { scope: string }) {
  const [best, setBest] = useState<number | null>(null)

  useEffect(() => {
    fetchBestTime(scope).then(setBest)
  }, [scope])

  if (best === null) return null

  return <span className="chip chip-accent ml-2 tabular-nums">Рекорд {formatTime(best)} с</span>
}