'use client'

import { useParams } from 'next/navigation'
import GeneralTrainLoader from '@/components/GeneralTrainLoader'

export default function GeneralMistakesTrainPage() {
  const params = useParams()
  const id = params.id as string

  return (
    <GeneralTrainLoader
      trainingId={id}
      onlyMistakes={true}
      exitHref={`/general/${id}/mistakes`}
    />
  )
}