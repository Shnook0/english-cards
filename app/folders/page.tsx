'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import { createFolder as createFolderLocal, fetchFolders } from '@/lib/offline/repo'

export default function FoldersPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

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
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загрузка папок</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-7 lg:p-10">
      <div className="page-in mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← На главную
          </Link>
          <span className="eyebrow">Библиотека</span>
        </div>

        <header className="border-b border-[#24221e] pb-6">
          <p className="eyebrow mb-3">Личные коллекции</p>
          <h1 className="display text-4xl md:text-5xl">Мои папки</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#948e82]">
            Собирайте слова по темам, ситуациям или собственным правилам.
          </p>
        </header>

        {error && (
          <div className="mt-5 border border-[#bb7464]/50 bg-[#bb7464]/10 px-4 py-3 text-sm text-[#d9a093]">
            {error}
          </div>
        )}

        <form onSubmit={createFolder} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder="Название новой папки"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            className="field flex-1"
          />
          <button
            type="submit"
            disabled={!newFolderName.trim() || creating}
            className="btn btn-primary"
          >
            {creating ? 'Создаём...' : 'Создать папку'}
          </button>
        </form>

        <section className="py-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Все папки</p>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#6f6a61]">
              {folders.length}
            </span>
          </div>

          {folders.length === 0 ? (
            <div className="panel px-6 py-10 text-center">
              <p className="text-sm text-[#948e82]">
                Пока нет папок. Создайте первую — и добавляйте в неё слова.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {folders.map((folder, index) => (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="panel panel-hover group flex items-center justify-between gap-4 px-4 py-3.5"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] text-[#6f6a61]">
                      {index + 1}
                    </span>
                    <span className="text-lg text-[#f2eee5] transition group-hover:text-[#c9a96e]">
                      {folder.name}
                    </span>
                  </div>
                  <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
