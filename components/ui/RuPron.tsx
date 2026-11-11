'use client'

import { useRuPronunciation } from '@/hooks/useRuPronunciation'
import { useCardPronunciation } from '@/lib/pronounceClient'

type PronCard = {
  word: string
  transcription?: string | null
  pronunciation_ru?: string | null
}

const SIZES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg sm:text-xl',
} as const

// Произношение русскими буквами отдельной строкой под английским словом.
// Скрывается, если выключено в настройках.
export default function RuPron({
  card,
  size = 'sm',
  className = '',
}: {
  card: PronCard | null | undefined
  size?: keyof typeof SIZES
  className?: string
}) {
  const [enabled] = useRuPronunciation()
  const text = useCardPronunciation(enabled ? card : null)
  if (!enabled || !text) return null
  return (
    <span className={`mt-1 block font-medium text-[#8ea2ff] ${SIZES[size]} ${className}`}>
      {text}
    </span>
  )
}
