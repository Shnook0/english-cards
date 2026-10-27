'use client'

import { useParams } from 'next/navigation'
import FolderTrain from '@/components/FolderTrain'

// Повтор только выученных слов папки (своей или уровня).
export default function RepeatLearnedPage() {
  const params = useParams()
  return <FolderTrain folderId={params.id as string} learnedOnly />
}
