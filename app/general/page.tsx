'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Folder } from '@/types/database'
import { GeneralTraining } from '@/types/general'
import {
  createGeneralTraining,
  deleteGeneralTraining,
  fetchFolders,
  fetchGeneralTrainingFolders,
  fetchGeneralTrainings,
} from '@/lib/offline/repo'

export default function GeneralPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()

  const [trainings, setTrainings] = useState<GeneralTraining[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [trainingFolders, setTrainingFolders] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'all' | 'custom'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const [list, folderList, map] = await Promise.all([
      fetchGeneralTrainings(user.id),
      fetchFolders(user.id, 'custom'),
      fetchGeneralTrainingFolders(user.id),
    ])

    setTrainings(list)
    setFolders(folderList)
    setTrainingFolders(map)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const toggleSelected = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const createTraining = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || creating) return
    if (scope === 'custom' && selected.length === 0) return

    setCreating(true)
    setError(null)

    const defaultName =
      scope === 'all'
        ? 'Все папки'
        : folders.filter(f => selected.includes(f.id)).map(f => f.name).join(', ')
    const finalName = name.trim() || defaultName

    try {
      await createGeneralTraining(user.id, finalName, scope, selected)
    } catch {
      setError('Не удалось создать тренировку')
      setCreating(false)
      return
    }

    setName('')
    setSelected([])
    setScope('all')
    setShowForm(false)
    setCreating(false)
    await load()
  }

  const deleteTraining = async (t: GeneralTraining) => {
    if (!confirm(`Удалить тренировку «${t.name}» вместе с её прогрессом? Карточки и папки не пострадают.`)) return
    try {
      await deleteGeneralTraining(t.id)
    } catch {
      setError('Не удалось удалить тренировку')
      return
    }
    setTrainings(prev => prev.filter(x => x.id !== t.id))
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем тренировки…</span>
      </div>
    )
  }

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Тренировки"
        description="Набор слов из нескольких папок, который вы повторяете вместе. Приложение само решает, какие слова показать сегодня."
        actions={
          !showForm && (
            <button onClick={() => setShowForm(true)} className="btn btn-secondary btn-sm">
              <Icon name="plus" size={16} />
              Создать
            </button>
          )
        }
      />

      <div className="hint">
        <Icon name="info" size={18} />
        <p>
          «Знаю» — слово вернётся позже: через 1, 2, 3 дня и дальше, до 30 дней.
          «Не знаю» — слово на 2 дня попадёт в ошибки и будет показываться первым.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={createTraining} className="card mt-4 space-y-4 p-5">
          <h2 className="text-lg">Новая тренировка</h2>

          <input
            type="text"
            placeholder="Название (необязательно)"
            value={name}
            onChange={e => setName(e.target.value)}
            className="field"
          />

          <div className="space-y-2 text-[15px]">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#24242b] px-4 py-3">
              <input
                type="radio"
                name="scope"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
                className="mt-1 accent-[#8ea2ff]"
              />
              <span>
                Все папки
                <span className="mt-0.5 block text-[13px] text-[#8a8a96]">
                  Новые папки и слова добавятся сами
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#24242b] px-4 py-3">
              <input
                type="radio"
                name="scope"
                checked={scope === 'custom'}
                onChange={() => setScope('custom')}
                className="mt-1 accent-[#8ea2ff]"
              />
              <span>
                Выбрать папки
                <span className="mt-0.5 block text-[13px] text-[#8a8a96]">
                  Только отмеченные ниже
                </span>
              </span>
            </label>
          </div>

          {scope === 'custom' && (
            <div className="space-y-1 rounded-xl bg-[#1b1b21] p-3">
              {folders.length === 0 ? (
                <p className="px-1 text-sm text-[#8a8a96]">У вас пока нет своих папок.</p>
              ) : (
                folders.map(f => (
                  <label
                    key={f.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-[15px]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(f.id)}
                      onChange={() => toggleSelected(f.id)}
                      className="accent-[#8ea2ff]"
                    />
                    <span className="min-w-0 truncate">{f.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="btn btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={creating || (scope === 'custom' && selected.length === 0)}
              className="btn btn-primary"
            >
              {creating ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      )}

      <h2 className="section-label">Ваши тренировки</h2>
      {trainings.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-10 text-center">
          <span className="tile-icon">
            <Icon name="spark" />
          </span>
          <p className="mt-4 text-[15px] text-[#b0b0bb]">
            Тренировок пока нет. Создайте первую — например, по всем папкам.
          </p>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="btn btn-primary mt-5">
              <Icon name="plus" size={18} />
              Создать тренировку
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {trainings.map(t => {
            const folderNames = (trainingFolders[t.id] ?? [])
              .map(id => folders.find(f => f.id === id)?.name)
              .filter(Boolean)
              .join(', ')
            return (
              <div key={t.id} className="card p-4">
                <Link href={`/general/${t.id}`} className="flex min-w-0 items-center gap-3">
                  <span className="tile-icon">
                    <Icon name="spark" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{t.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[#8a8a96]">
                      {t.scope === 'all' ? 'Все папки' : `Папки: ${folderNames || '—'}`}
                    </p>
                  </div>
                </Link>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button onClick={() => deleteTraining(t)} className="btn btn-ghost btn-sm">
                    Удалить
                  </button>
                  <Link href={`/general/${t.id}`} className="btn btn-primary btn-sm">
                    Открыть
                    <Icon name="arrowRight" size={16} />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}