'use client'

import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (user) load()
  }, [user])

  const load = async () => {
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
  }

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
      <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] flex items-center justify-center">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e8ec] p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-sm text-[#8b90a0] hover:text-[#6c7cff] transition">← На главную</Link>
        </div>

        <div className="flex items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold mb-1">Общая тренировка</h1>
            <p className="text-sm text-[#8b90a0]">Слова из папок с умным повторением</p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-[#6c7cff] px-5 py-2.5 font-medium text-white hover:bg-[#5865e0] transition"
            >
              + Создать
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm">
            {error}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={createTraining}
            className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-6 mb-8 space-y-4"
          >
            <h3 className="text-lg font-bold">Новая общая тренировка</h3>

            <input
              type="text"
              placeholder="Название (необязательно)"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-4 py-2.5 text-[#e6e8ec] placeholder-[#8b90a0] focus:border-[#6c7cff] focus:outline-none"
            />

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <span>По всем папкам (новые папки и слова добавятся сами)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
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
              <div className="rounded-lg bg-[#0f1115] p-3 space-y-2">
                {folders.length === 0 ? (
                  <p className="text-sm text-[#8b90a0]">У вас пока нет своих папок.</p>
                ) : (
                  folders.map(f => (
                    <label key={f.id} className="flex items-center gap-2 cursor-pointer">
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

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating || (scope === 'custom' && selected.length === 0)}
                className="rounded-lg bg-[#6c7cff] px-6 py-2.5 font-medium text-white hover:bg-[#5865e0] transition disabled:opacity-50"
              >
                {creating ? 'Создаём...' : 'Создать'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-700 px-6 py-2.5 font-medium hover:border-[#6c7cff] transition"
              >
                Отмена
              </button>
            </div>
          </form>
        )}

        {trainings.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-[#1a1d23] p-12 text-center text-[#8b90a0]">
            Общих тренировок пока нет. Создайте первую.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trainings.map(t => {
              const folderNames = (trainingFolders[t.id] ?? [])
                .map(id => folders.find(f => f.id === id)?.name)
                .filter(Boolean)
                .join(', ')
              return (
                <div
                  key={t.id}
                  className="rounded-xl border border-gray-800 bg-[#1a1d23] p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <h3 className="text-lg font-bold mb-1">{t.name}</h3>
                    <p className="text-xs text-[#8b90a0]">
                      {t.scope === 'all' ? 'Все папки' : `Папки: ${folderNames || '—'}`}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/general/${t.id}`}
                      className="rounded-lg bg-[#6c7cff] px-4 py-2 text-sm font-medium text-white hover:bg-[#5865e0] transition"
                    >
                      Открыть
                    </Link>
                    <button
                      onClick={() => deleteTraining(t)}
                      className="text-xs text-[#a04a4a] hover:opacity-80 transition"
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