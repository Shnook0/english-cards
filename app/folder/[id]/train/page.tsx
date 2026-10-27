'use client'

import { useParams } from 'next/navigation'
import FolderTrain from '@/components/FolderTrain'

export default function TrainFolderPage() {
  const params = useParams()
  return <FolderTrain folderId={params.id as string} />
}
