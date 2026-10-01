'use client'

import { useParams } from 'next/navigation'
import GeneralTrainLoader from '@/components/GeneralTrainLoader'

export default function GeneralTrainPage() {
  const params = useParams()
  const id = params.id as string

  return (
    <GeneralTrainLoader
      trainingId={id}
      onlyMistakes={false}
      exitHref={`/general/${id}`}
    />
  )
}