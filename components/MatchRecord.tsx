'use client'

import { useEffect, useState } from 'react'
import { fetchBestTime, formatTime } from '@/lib/records'

export default function MatchRecord({ scope }: { scope: string }) {
  const [best, setBest] = useState<number | null>(null)

  useEffect(() => {
    fetchBestTime(scope).then(setBest)
  }, [scope])

  if (best === null) return null

  return <span className="ml-2 text-xs text-[#8b90a0]">🏆 {formatTime(best)} с</span>
}