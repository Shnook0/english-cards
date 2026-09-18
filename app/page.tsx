'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import { CEFR_LEVELS, CEFR_WORDS, type CefrLevel } from '@/data/cefr'

export default function HomePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [folders, setFolders] = useState<Folder[]>([])
  const [learnedFolder, setLearnedFolder] = useState<Folder | null>(null)
  const [levelFolders, setLevelFolders] = useState<Record<string, Folder>>({})
  const [learnedCount, setLearnedCount] = useState(0)
  const [newFolderName, setNewFolderName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [creatingLevel, setCreatingLevel] = useState<CefrLevel | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) load()
  }, [user])

  const load = async () => {
    setLoadingData(true)
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      setError('Ошибка загрузки папок')
      setLoadingData(false)
      return
    }

    const list = (data ?? []) as Folder[]
    const learned = list.find(f => f.type === 'learned') ?? null
    setLearnedFolder(learned)
    setFolders(list.filter(f => f.type === 'custom'))

    const levelsMap: Record<string, Folder> = {}
    list.filter(f => f.type === 'level').forEach(f => {
      levelsMap[f.name] = f
    })
    setLevelFolders(levelsMap)

    const { count } = await supabase
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .not('learned_at', 'is', null)

    setLearnedCount(count ?? 0)
    setLoadingData(false)
  }

  const openLevel = async (level: CefrLevel) => {
    if (!user) return

    const existing = levelFolders[level]
    if (existing) {
      router.push(`/folder/${existing.id}`)
      return
    }

    setCreatingLevel(level)
    setError(null)

    const { data: folder, error: fErr } = await supabase
      .from('folders')
      .insert({ user_id: user.id, name: level, type: 'level' })
      .select()
      .single()

    if (fErr || !folder) {
      setError('Не удалось создать папку уровня')
      setCreatingLevel(null)
      return
    }

    const words = CEFR_WORDS[level]
    const rows = words.map(w => ({
      user_id: user.id,
      folder_id: folder.id,
      word: w.word,
      transcription: w.transcription || null,
      translation: w.translation,
      sentences: w.sentences || [],
    }))

    const { error: cErr } = await supabase.from('cards').insert(rows)
    if (cErr) {
      setError('Ошибка при заполнении слов')
      setCreatingLevel(null)
      return
    }

    setCreatingLevel(null)
    router.push(`/folder/${folder.id}`)
  }

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name || !user) return

    const { data, error } = await supabase
      .from('folders')
      .insert({ user_id: user.id, name, type: 'custom' })
      .select()
      .single()

    if (error) {
      setError('Не удалось создать папку')
    } else if (data) {
      setFolders(prev => [...prev, data as Folder])
      setNewFolderName('')
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (authLoading || loadingData) {
    return (
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-800">
          <span className="text-sm text-[#8b90a0]">{user?.email}</span>
          <button
            onClick={logout}
            className="text-sm text-[#8b90a0] hover:text-[#a04a4a] transition"
          >
            Выйти
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {learnedFolder && (
            <Link
              href={`/folder/${learnedFolder.id}`}
              className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-5 hover:border-[#6c7cff] transition flex flex-col justify-between"
            >
              <h3 className="text-lg font-bold mb-1">Выученные</h3>
              <p className="text-sm text-[#8b90a0]">Выучено слов: {learnedCount}</p>
            </Link>
          )}

          <Link
            href="/favorites"
            className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-5 hover:border-[#6c7cff] transition flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold">Избранные</h3>
              <span className="text-[#6c7cff]">★</span>
            </div>
            <p className="text-sm text-[#8b90a0]">Повторить избранные</p>
          </Link>

          <Link
            href="/mistakes"
            className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-5 hover:border-[#6c7cff] transition flex flex-col justify-between"
          >
            <h3 className="text-lg font-bold mb-1">Частые ошибки</h3>
            <p className="text-sm text-[#8b90a0]">Слова для проработки</p>
          </Link>
        </div>

        {/* Подборки по уровням */}
        <div className="mb-8">
          <h3 className="text-xl font-bold mb-4">Подборки по уровням</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {CEFR_LEVELS.map(level => {
              const exists = !!levelFolders[level]
              const busy = creatingLevel === level
              return (
                <button
                  key={level}
                  onClick={() => openLevel(level)}
                  disabled={busy}
                  className={`rounded-2xl border p-5 text-left transition disabled:opacity-50 ${
                    exists
                      ? 'border-[#6c7cff]/40 bg-[#6c7cff]/10 hover:border-[#6c7cff]'
                      : 'border-gray-800 bg-[#1a1d23] hover:border-[#6c7cff]'
                  }`}
                >
                  <div className="text-lg font-bold">{level}</div>
                  <div className="text-xs text-[#8b90a0] mt-1">
                    {busy ? 'Создаём...' : exists ? 'Открыть' : 'Создать'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 mb-8">
          <h3 className="text-lg font-bold mb-4">Создать папку</h3>
          <form onSubmit={createFolder} className="flex gap-3">
            <input
              type="text"
              placeholder="Название папки..."
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              className="flex-1 rounded-lg border border-gray-700 bg-[#0f1115] px-4 py-2.5 text-[#e6e8ec] placeholder-[#8b90a0] focus:border-[#6c7cff] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newFolderName.trim()}
              className="rounded-lg bg-[#6c7cff] px-6 py-2.5 font-medium text-white hover:bg-[#5865e0] transition disabled:opacity-50"
            >
              Создать
            </button>
          </form>
        </div>

        <div>
          <h3 className="text-xl font-bold mb-4">Мои папки</h3>
          {folders.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-8 text-center text-[#8b90a0]">
              У вас пока нет папок. Создайте первую выше.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {folders.map(folder => (
                <Link
                  key={folder.id}
                  href={`/folder/${folder.id}`}
                  className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 hover:border-[#6c7cff] transition flex items-center justify-between"
                >
                  <span className="font-semibold">{folder.name}</span>
                  <span className="text-xs text-[#8b90a0]">Открыть →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}