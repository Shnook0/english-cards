'use client'

import { useRuPronunciation } from '@/hooks/useRuPronunciation'

// «(сайтсиинг)» рядом со словом; скрывается, если выключено в настройках.
export default function RuPron({ value }: { value?: string | null }) {
  const [enabled] = useRuPronunciation()
  const text = value?.trim()
  if (!enabled || !text) return null
  return <span className="font-normal text-[#b0b0bb]"> ({text})</span>
}
