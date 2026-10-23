'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import { GeneralTraining } from '@/types/general'

export default function GeneralPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

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
    setLoading(true)
    setError(null)

    const [tRes, fRes, tfRes] = await Promise.all([
      supabase.from('general_trainings').select('*').order('created_at', { ascending: false }),
      supabase.from('folders').select('*').eq('type', 'custom').order('created_at', { ascending: true }),
      supabase.from('general_training_folders').select('*'),
    ])

    if (tRes.error) {
      setError('Ошибка загрузки тренировок. Проверьте, что таблицы созданы в Supabase.')
      setLoading(false)
      return
    }

    setTrainings((tRes.data ?? []) as GeneralTraining[])
    setFolders((fRes.data ?? []) as Folder[])

    const map: Record<string, string[]> = {}
    for (const row of (tfRes.data ?? []) as { training_id: string; folder_id: string }[]) {
      if (!map[row.training_id]) map[row.training_id] = []
      map[row.training_id].push(row.folder_id)
    }
    setTrainingFolders(map)
    setLoading(false)
  }, [])

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

    const { data: tr, error: tErr } = await supabase
      .from('general_trainings')
      .insert({ user_id: user.id, name: finalName, scope })
      .select()
      .single()

    if (tErr || !tr) {
      setError('Не удалось создать тренировку')
      setCreating(false)
      return
    }

    if (scope === 'custom') {
      const rows = selected.map(fid => ({ training_id: tr.id, folder_id: fid }))
      const { error: fErr } = await supabase.from('general_training_folders').insert(rows)
      if (fErr) {
        setError('Не удалось сохранить выбранные папки')
        setCreating(false)
        return
      }
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
    const { error: dErr } = await supabase.from('general_trainings').delete().eq('id', t.id)
    if (dErr) {
      setError('Не удалось удалить тренировку')
      return
    }
    setTrainings(prev => prev.filter(x => x.id !== t.id))
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#090909] text-[#f2eee5] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="min-h-screen px-5 py-8 md:px-10 md:py-14">
      <div className="page-in mx-auto max-w-5xl">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← На главную
          </Link>
          <span className="eyebrow">Общая практика</span>
        </div>

        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-[#24221e] pb-8">
          <div>
            <p className="eyebrow mb-3">Единый словарь</p>
            <h1 className="display text-5xl md:text-6xl">Общая тренировка</h1>
            <p className="mt-4 text-sm text-[#948e82]">
              Слова из папок с умным повторением
            </p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="btn btn-primary">
              + Создать
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 border border-[#bb7464]/50 bg-[#bb7464]/10 p-4 text-sm text-[#e3b4a8]">
            {error}
          </div>
        )}

        {showForm && (
          <form onSubmit={createTraining} className="panel mb-8 space-y-5 p-6 md:p-8">
            <div>
              <p className="eyebrow mb-2">Новый набор</p>
              <h3 className="text-2xl">Новая общая тренировка</h3>
            </div>

            <input
              type="text"
              placeholder="Название (необязательно)"
              value={name}
              onChange={e => setName(e.target.value)}
              className="field"
            />

            <div className="space-y-3 text-sm">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <span>По всем папкам — новые папки и слова добавятся сами</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'custom'}
                  onChange={() => setScope('custom')}
                />
                <span>Выбрать папки</span>
              </label>
            </div>

            {scope === 'custom' && (
              <div className="space-y-3 border border-[#24221e] bg-black/20 p-4">
                {folders.length === 0 ? (
                  <p className="text-sm text-[#948e82]">У вас пока нет своих папок.</p>
                ) : (
                  folders.map(f => (
                    <label key={f.id} className="flex cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(f.id)}
                        onChange={() => toggleSelected(f.id)}
                      />
                      <span>{f.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={creating || (scope === 'custom' && selected.length === 0)}
                className="btn btn-primary"
              >
                {creating ? 'Создаём...' : 'Создать'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary"
              >
                Отмена
              </button>
            </div>
          </form>
        )}

        {trainings.length === 0 ? (
          <div className="panel p-14 text-center">
            <p className="display mb-3 text-3xl">Пока пусто</p>
            <p className="text-sm text-[#948e82]">
              Общих тренировок нет. Создайте первую.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {trainings.map(t => {
              const folderNames = (trainingFolders[t.id] ?? [])
                .map(id => folders.find(f => f.id === id)?.name)
                .filter(Boolean)
                .join(', ')
              return (
                <div
                  key={t.id}
                  className="panel panel-hover flex flex-col justify-between gap-6 p-6"
                >
                  <div>
                    <p className="eyebrow mb-3">Набор</p>
                    <h3 className="text-2xl">{t.name}</h3>
                    <p className="mt-2 text-xs leading-5 text-[#948e82]">
                      {t.scope === 'all' ? 'Все папки' : `Папки: ${folderNames || '—'}`}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Link href={`/general/${t.id}`} className="btn btn-primary">
                      Открыть
                    </Link>
                    <button
                      onClick={() => deleteTraining(t)}
                      className="text-xs text-[#bb7464] transition hover:opacity-75"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}