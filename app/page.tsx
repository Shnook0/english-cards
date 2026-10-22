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
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загрузка лексикона</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-5 md:p-10 lg:p-14">
      <div className="page-in mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-[#24221e] pb-6">
          <Link href="/" className="group flex flex-col">
            <span className="eyebrow">Personal lexicon</span>
            <span className="display mt-1 text-2xl text-[#f2eee5] transition group-hover:text-[#c9a96e]">
              English Cards
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <span className="hidden text-xs text-[#948e82] sm:block">{user?.email}</span>
            <button onClick={logout} className="btn btn-ghost !px-0 !py-0 text-[11px]">
              Выйти
            </button>
          </div>
        </header>

        <section className="grid gap-10 py-12 md:grid-cols-[1.35fr_0.65fr] md:items-end md:py-16">
          <div>
            <p className="eyebrow mb-5">Ваш личный словарь</p>
            <h1 className="display max-w-3xl text-5xl md:text-7xl">
              Слова,
              <br />
              которые остаются.
            </h1>
            <p className="mt-7 max-w-xl text-sm leading-7 text-[#948e82]">
              Тихая работа с языком: карточки, повторения и короткие тренировки.
              Без лишнего шума — только то, что помогает запоминать.
            </p>
          </div>

          <div className="panel p-6 md:p-8">
            <div className="flex items-start justify-between">
              <p className="eyebrow">Прогресс</p>
              <span className="font-mono text-[10px] text-[#c9a96e]">01</span>
            </div>
            <div className="mt-9 grid grid-cols-2 gap-6">
              <div>
                <div className="stat-number">{learnedCount}</div>
                <div className="mt-2 text-[11px] leading-4 text-[#948e82]">Выучено слов</div>
              </div>
              <div>
                <div className="stat-number">{folders.length}</div>
                <div className="mt-2 text-[11px] leading-4 text-[#948e82]">Личных папок</div>
              </div>
            </div>
            <div className="mt-8 h-px bg-[#24221e]" />
            <p className="mt-4 text-[11px] leading-5 text-[#948e82]">
              Уровни A1–C2 и общая тренировка работают автоматически.
            </p>
          </div>
        </section>

        {error && (
          <div className="mb-8 border border-[#bb7464]/50 bg-[#bb7464]/10 px-4 py-3 text-sm text-[#d9a093]">
            {error}
          </div>
        )}

        <section className="mb-14">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="eyebrow">01 / Практика</p>
              <h2 className="mt-2 text-2xl md:text-3xl">Начните с главного</h2>
            </div>
          </div>
          <Link
            href="/general"
            className="panel panel-hover group flex flex-col justify-between gap-8 p-6 md:flex-row md:items-center md:p-8"
          >
            <div>
              <p className="eyebrow mb-3">Умное повторение</p>
              <h3 className="text-2xl md:text-3xl">Общая тренировка</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#948e82]">
                Слова из всех или выбранных папок. Система сама решает, что показать
                сегодня.
              </p>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#c9a96e]/50 text-lg text-[#c9a96e] transition group-hover:bg-[#c9a96e] group-hover:text-[#0b0b0a]">
              →
            </span>
          </Link>
        </section>

        <section className="mb-14">
          <div className="mb-5">
            <p className="eyebrow">02 / Коллекции</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {learnedFolder && (
              <Link
                href={`/folder/${learnedFolder.id}`}
                className="panel panel-hover flex min-h-36 flex-col justify-between p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Архив</span>
                  <span className="text-xs text-[#c9a96e]">→</span>
                </div>
                <div>
                  <h3 className="text-xl">Выученные</h3>
                  <p className="mt-2 text-xs text-[#948e82]">{learnedCount} слов</p>
                </div>
              </Link>
            )}

            <Link
              href="/favorites"
              className="panel panel-hover flex min-h-36 flex-col justify-between p-6"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">Отобранное</span>
                <span className="text-xs text-[#c9a96e]">★</span>
              </div>
              <div>
                <h3 className="text-xl">Избранные</h3>
                <p className="mt-2 text-xs text-[#948e82]">Повторить избранные</p>
              </div>
            </Link>

            <Link
              href="/mistakes"
              className="panel panel-hover flex min-h-36 flex-col justify-between p-6"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">Точки роста</span>
                <span className="text-xs text-[#bb7464]">→</span>
              </div>
              <div>
                <h3 className="text-xl">Частые ошибки</h3>
                <p className="mt-2 text-xs text-[#948e82]">Слова для проработки</p>
              </div>
            </Link>
          </div>
        </section>

        <section className="mb-14">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <p className="eyebrow">03 / Уровни</p>
              <h2 className="mt-2 text-2xl md:text-3xl">Подборки по уровням</h2>
            </div>
            <p className="hidden text-xs text-[#948e82] md:block">A1 — C2</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {CEFR_LEVELS.map(level => {
              const exists = !!levelFolders[level]
              const busy = creatingLevel === level
              return (
                <button
                  key={level}
                  onClick={() => openLevel(level)}
                  disabled={busy}
                  className={`group border p-5 text-left transition disabled:opacity-50 ${
                    exists
                      ? 'border-[#c9a96e]/45 bg-[#c9a96e]/[0.06] hover:border-[#c9a96e]'
                      : 'border-[#24221e] bg-[#111110] hover:border-[#c9a96e]/60'
                  }`}
                >
                  <div className="display text-3xl">{level}</div>
                  <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[#948e82]">
                    <span>{busy ? 'Создаём' : exists ? 'Открыть' : 'Создать'}</span>
                    <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="grid gap-10 border-t border-[#24221e] pt-10 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">04 / Библиотека</p>
            <h2 className="mt-2 text-2xl md:text-3xl">Мои папки</h2>
            <p className="mt-3 max-w-xs text-xs leading-6 text-[#948e82]">
              Создавайте тематические коллекции и добавляйте слова вручную или
              текстовым импортом.
            </p>
            <form onSubmit={createFolder} className="mt-6 flex gap-2">
              <input
                type="text"
                placeholder="Название папки"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                className="field flex-1"
              />
              <button type="submit" disabled={!newFolderName.trim()} className="btn btn-primary">
                +
              </button>
            </form>
          </div>

          <div>
            {folders.length === 0 ? (
              <div className="panel flex min-h-40 items-center justify-center p-8 text-center text-sm text-[#948e82]">
                У вас пока нет папок. Создайте первую слева.
              </div>
            ) : (
              <div className="border-t border-[#24221e]">
                {folders.map((folder, index) => (
                  <Link
                    key={folder.id}
                    href={`/folder/${folder.id}`}
                    className="group flex items-center justify-between border-b border-[#24221e] py-5 transition hover:border-[#c9a96e]/40"
                  >
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-[10px] text-[#6f6a61]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-lg text-[#f2eee5] transition group-hover:text-[#c9a96e]">
                        {folder.name}
                      </span>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#948e82] transition group-hover:text-[#c9a96e]">
                      Открыть →
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <footer className="mt-16 flex items-center justify-between border-t border-[#24221e] py-6 text-[10px] uppercase tracking-[0.18em] text-[#6f6a61]">
          <span>English Cards</span>
          <span>Личный лексикон</span>
        </footer>
      </div>
    </div>
  )
}