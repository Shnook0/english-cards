'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import { Folder } from '@/types/database'
import { CEFR_LEVELS, CEFR_WORDS, type CefrLevel } from '@/data/cefr'
import {
  createCards,
  createFolder,
  deleteFolder,
  fetchFolders,
} from '@/lib/offline/repo'

export default function LevelsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

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

      const data = await fetchFolders(user.id, 'level')

      if (cancelled) return

      const map: Record<string, Folder> = {}
      for (const folder of data) {
        map[folder.name] = folder
      }
      setLevelFolders(map)
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

    let folder: Folder
    try {
      folder = await createFolder(user.id, level, 'level')
    } catch {
      setError('Не удалось создать папку уровня')
      setCreatingLevel(null)
      return
    }

    const rows = CEFR_WORDS[level].map(word => ({
      word: word.word,
      transcription: word.transcription || null,
      translation: word.translation,
      sentences: word.sentences || [],
    }))

    try {
      await createCards(user.id, folder.id, rows)
    } catch {
      await deleteFolder(folder.id).catch(() => {})
      setError('Не удалось заполнить уровень словами')
      setCreatingLevel(null)
      return
    }

    setCreatingLevel(null)
    router.push(`/folder/${folder.id}`)
  }

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем уровни…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Уровни A1–C2"
        description="Готовые наборы слов по уровням владения языком — с переводом и примерами. Выберите свой уровень и начните учить."
      />

      <div className="hint mb-5">
        <Icon name="info" size={18} />
        <p>A1–A2 — начальный, B1–B2 — средний, C1–C2 — продвинутый. При первом открытии создаётся ваша копия набора — в ней сохраняется прогресс.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {CEFR_LEVELS.map(level => {
          const exists = Boolean(levelFolders[level])
          const busy = creatingLevel === level

          return (
            <button
              key={level}
              type="button"
              onClick={() => openLevel(level)}
              disabled={Boolean(creatingLevel)}
              className="tile text-left disabled:cursor-not-allowed disabled:opacity-50"
              style={exists ? { borderColor: 'rgba(142, 162, 255, 0.45)' } : undefined}
            >
              <div className="flex items-center justify-between">
                <span className="display text-[1.75rem] text-[#ececf1]">{level}</span>
                {exists && (
                  <span className="chip chip-accent">
                    <Icon name="check" size={14} />
                    добавлен
                  </span>
                )}
              </div>
              <div className="mt-auto">
                <p className="tile-title">
                  {busy ? 'Создаём…' : exists ? 'Открыть набор' : 'Добавить набор'}
                </p>
                <p className="tile-text">{CEFR_WORDS[level].length} слов</p>
              </div>
            </button>
          )
        })}
      </section>
    </div>
  )
}
