'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import { CEFR_LEVELS, CEFR_WORDS, type CefrLevel } from '@/data/cefr'

export default function LevelsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [levelFolders, setLevelFolders] = useState<Record<string, Folder>>({})
  const [loadingData, setLoadingData] = useState(true)
  const [creatingLevel, setCreatingLevel] = useState<CefrLevel | null>(null)
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

      const { data, error: loadError } = await supabase
        .from('folders')
        .select('*')
        .eq('type', 'level')
        .order('created_at', { ascending: true })

      if (cancelled) return

      if (loadError) {
        setError('Не удалось загрузить уровни')
      } else {
        const map: Record<string, Folder> = {}
        for (const folder of (data ?? []) as Folder[]) {
          map[folder.name] = folder
        }
        setLevelFolders(map)
      }
      setLoadingData(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user])

  const openLevel = async (level: CefrLevel) => {
    if (!user || creatingLevel) return

    const existing = levelFolders[level]
    if (existing) {
      router.push(`/folder/${existing.id}`)
      return
    }

    setCreatingLevel(level)
    setError(null)

    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .insert({ user_id: user.id, name: level, type: 'level' })
      .select()
      .single()

    if (folderError || !folder) {
      setError('Не удалось создать папку уровня')
      setCreatingLevel(null)
      return
    }

    const rows = CEFR_WORDS[level].map(word => ({
      user_id: user.id,
      folder_id: folder.id,
      word: word.word,
      transcription: word.transcription || null,
      translation: word.translation,
      sentences: word.sentences || [],
    }))

    const { error: cardsError } = await supabase.from('cards').insert(rows)

    if (cardsError) {
      await supabase.from('folders').delete().eq('id', folder.id)
      setError('Не удалось заполнить уровень словами')
      setCreatingLevel(null)
      return
    }

    setCreatingLevel(null)
    router.push(`/folder/${folder.id}`)
  }

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загрузка уровней</span>
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
          <span className="eyebrow">CEFR</span>
        </div>

        <header className="border-b border-[#24221e] pb-6">
          <p className="eyebrow mb-3">Готовые наборы</p>
          <h1 className="display text-4xl md:text-5xl">Подборки по уровням</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#948e82]">
            Начните с подходящего уровня — слова и примеры уже собраны.
          </p>
        </header>

        {error && (
          <div className="mt-5 border border-[#bb7464]/50 bg-[#bb7464]/10 px-4 py-3 text-sm text-[#d9a093]">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 gap-2 py-6 md:grid-cols-3">
          {CEFR_LEVELS.map(level => {
            const exists = Boolean(levelFolders[level])
            const busy = creatingLevel === level

            return (
              <button
                key={level}
                type="button"
                onClick={() => openLevel(level)}
                disabled={Boolean(creatingLevel)}
                className={`group flex min-h-28 flex-col justify-between border p-4 text-left transition disabled:opacity-50 ${
                  exists
                    ? 'border-[#c9a96e]/45 bg-[#c9a96e]/[0.06] hover:border-[#c9a96e]'
                    : 'border-[#24221e] bg-[#111110] hover:border-[#c9a96e]/60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="display text-2xl">{level}</span>
                  <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
                </div>
                <div>
                  <p className="text-sm">
                    {busy ? 'Создаём...' : exists ? 'Открыть набор' : 'Создать набор'}
                  </p>
                  <p className="mt-1 text-[10px] text-[#948e82]">
                    {CEFR_WORDS[level].length} слов
                  </p>
                </div>
              </button>
            )
          })}
        </section>
      </div>
    </div>
  )
}
