'use client'

import { useParams } from 'next/navigation'
import StudyLoader from '@/components/StudyLoader'

export default function FolderPlayPage() {
  const params = useParams()
  const id = params.id as string
  const mode = params.mode as string

  return (
    <StudyLoader
      kind="folder"
      folderId={id}
      mode={mode}
      exitHref={`/folder/${id}`}
    />
  )
}