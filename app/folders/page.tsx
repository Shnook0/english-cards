'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Folder } from '@/types/database'
import { createFolder as createFolderLocal, fetchFolders } from '@/lib/offline/repo'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'

export default function FoldersPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

  const [folders, setFolders] = useState<Folder[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [loadingData, setLoadingData] = useState(true)
  const [creating, setCreating] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (!user) return

    let cancelled = false

    const load = async () => {
      setLoadingData(true)
      setError(null)

      const data = await fetchFolders(user.id, 'custom')

      if (cancelled) return

      setFolders(data)
      setLoadingData(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user, reloadKey])

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name || !user || creating) return

    setCreating(true)
    setError(null)

    try {
      await createFolderLocal(user.id, name, 'custom')
    } catch {
      setError('Не удалось создать папку')
      setCreating(false)
      return
    }

    setNewFolderName('')
    setCreating(false)
    setReloadKey(value => value + 1)
  }

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем папки…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Мои папки"
        description="Собирайте слова по темам: создайте папку, откройте её и добавьте слова."
      />

      {error && (
        <div className="mb-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error}
        </div>
      )}

      <form onSubmit={createFolder} className="card flex gap-2 p-3">
        <input
          type="text"
          placeholder="Название новой папки"
          value={newFolderName}
          onChange={e => setNewFolderName(e.target.value)}
          className="field min-w-0 flex-1"
          aria-label="Название новой папки"
        />
        <button
          type="submit"
          disabled={!newFolderName.trim() || creating}
          className="btn btn-primary shrink-0"
        >
          <Icon name="plus" size={18} />
          {creating ? 'Создаём…' : 'Создать'}
        </button>
      </form>

      <h2 className="section-label flex items-center justify-between">
        <span>Все папки</span>
        <span className="font-normal text-[#6b6b76]">{folders.length}</span>
      </h2>

      {folders.length === 0 ? (
        <div className="hint">
          <Icon name="info" size={18} />
          <p>Пока нет папок. Введите название выше — например, «Путешествия» — и нажмите «Создать».</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {folders.map(folder => (
            <Link
              key={folder.id}
              href={`/folder/${folder.id}`}
              className="card card-link flex items-center gap-3 px-4 py-3.5"
            >
              <span className="tile-icon">
                <Icon name="folder" />
              </span>
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-[#ececf1]">
                {folder.name}
              </span>
              <Icon name="arrowRight" size={18} className="shrink-0 text-[#6b6b76]" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
