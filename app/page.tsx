'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import TelegramBanner from '@/components/TelegramBanner'

function vocabularyPhrase(count: number): string {
  if (count === 0) return 'Пока пусто — но начало уже положено.'
  if (count < 20) return 'Примерно как у малыша, который учится говорить.'
  if (count < 50) return 'Примерно как у дошкольника, который торгуется за конфеты.'
  if (count < 100) return 'Примерно как у первоклассника, который читает вывески.'
  if (count < 250) return 'Примерно как у школьника, который спорит о мультиках.'
  if (count < 500) return 'Примерно как у подростка, который уверенно болтает.'
  if (count < 1000) return 'Примерно как у взрослого, который читает новости.'
  if (count < 2000) return 'Примерно как у начитанного взрослого.'
  if (count < 5000) return 'Примерно как у библиотекаря в отпуске.'
  return 'Словарный запас уже неприлично хорош.'
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()

  const [folders, setFolders] = useState<Folder[]>([])
  const [learnedFolder, setLearnedFolder] = useState<Folder | null>(null)
  const [learnedCount, setLearnedCount] = useState(0)
  const [favoritesCount, setFavoritesCount] = useState(0)
  const [mistakesCount, setMistakesCount] = useState(0)
  const [loadingData, setLoadingData] = useState(true)
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

      const [folderRes, learnedRes, favoritesRes, mistakesRes] = await Promise.all([
        supabase.from('folders').select('*').order('created_at', { ascending: true }),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .not('learned_at', 'is', null),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .eq('is_favorite', true),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .gte('wrong_count', 2),
      ])

      if (cancelled) return

      if (folderRes.error) {
        setError('Ошибка загрузки папок')
        setLoadingData(false)
        return
      }

      const list = (folderRes.data ?? []) as Folder[]
      setFolders(list)
      setLearnedFolder(list.find(folder => folder.type === 'learned') ?? null)
      setLearnedCount(learnedRes.count ?? 0)
      setFavoritesCount(favoritesRes.count ?? 0)
      setMistakesCount(mistakesRes.count ?? 0)
      setLoadingData(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user])

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

  const customFolders = folders.filter(folder => folder.type === 'custom')
  const levelFolders = folders.filter(folder => folder.type === 'level')

  return (
    <div className="min-h-screen p-4 md:p-7 lg:p-10">
      <div className="page-in mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-[#24221e] pb-5">
          <Link href="/" className="group flex flex-col">
            <span className="eyebrow">Personal lexicon</span>
            <span className="display mt-1 text-2xl text-[#f2eee5] transition group-hover:text-[#c9a96e]">
              English Cards
            </span>
          </Link>

          <div className="flex items-start gap-5">
            <div className="max-w-[190px] text-right sm:max-w-[260px]">
              <p className="eyebrow">Словарный запас</p>
              <p className="mt-1 flex items-baseline justify-end gap-1.5">
                <span className="display text-2xl text-[#f2eee5]">{learnedCount}</span>
                <span className="text-[9px] uppercase tracking-[0.16em] text-[#948e82]">
                  слов
                </span>
              </p>
              <p className="mt-1 text-[10px] leading-4 text-[#948e82]">
                {vocabularyPhrase(learnedCount)}
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className="hidden text-[11px] text-[#948e82] md:block">{user?.email}</span>
              <button onClick={logout} className="btn btn-ghost !px-0 !py-0 text-[10px]">
                Выйти
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mt-5 border border-[#bb7464]/50 bg-[#bb7464]/10 px-4 py-3 text-sm text-[#d9a093]">
            {error}
          </div>
        )}

        <section className="grid gap-2 py-5 sm:grid-cols-2">
          <Link
            href="/favorites"
            className="panel panel-hover group flex items-center justify-between gap-4 px-5 py-4"
          >
            <div>
              <p className="eyebrow">Быстрый доступ</p>
              <h2 className="mt-1.5 text-xl">Избранные слова</h2>
              <p className="mt-1.5 text-sm leading-5 text-[#b5aea1]">
                Слова, отмеченные звёздочкой · {favoritesCount}
              </p>
            </div>
            <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
          </Link>

          <Link
            href="/mistakes"
            className="panel panel-hover group flex items-center justify-between gap-4 px-5 py-4"
          >
            <div>
              <p className="eyebrow">Точки роста</p>
              <h2 className="mt-1.5 text-xl">Частые ошибки</h2>
              <p className="mt-1.5 text-sm leading-5 text-[#b5aea1]">
                Слова, которые стоит повторить · {mistakesCount}
              </p>
            </div>
            <span className="text-[#bb7464] transition group-hover:translate-x-0.5">→</span>
          </Link>
        </section>

        <section className="grid gap-3 pb-2 md:grid-cols-3">
          <Link
            href="/folders"
            className="panel panel-hover group flex min-h-36 flex-col justify-between p-5"
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-xs text-[#c9a96e]">1</span>
              <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
            </div>
            <div>
              <h2 className="text-2xl">Мои папки</h2>
              <p className="mt-2.5 text-sm leading-6 text-[#b5aea1]">
                Личные подборки слов по темам · {customFolders.length}
              </p>
            </div>
          </Link>

          <Link
            href="/general"
            className="panel panel-hover group flex min-h-36 flex-col justify-between p-5"
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-xs text-[#c9a96e]">2</span>
              <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
            </div>
            <div>
              <h2 className="text-2xl">Общая тренировка</h2>
              <p className="mt-2.5 text-sm leading-6 text-[#b5aea1]">
                Умное повторение слов из всех папок.
              </p>
            </div>
          </Link>

          <Link
            href="/levels"
            className="panel panel-hover group flex min-h-36 flex-col justify-between p-5"
          >
            <div className="flex items-start justify-between">
              <span className="font-mono text-xs text-[#c9a96e]">3</span>
              <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
            </div>
            <div>
              <h2 className="text-2xl">Подборки по уровням</h2>
              <p className="mt-2.5 text-sm leading-6 text-[#b5aea1]">
                Готовые наборы от A1 до C2 · {levelFolders.length}
              </p>
            </div>
          </Link>
        </section>

        <footer className="mt-6 border-t border-[#24221e] pt-4">
          {learnedFolder ? (
            <Link
              href={`/folder/${learnedFolder.id}`}
              className="group flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="eyebrow">Архив</span>
              <span className="flex items-center gap-3 text-[#948e82] transition group-hover:text-[#f2eee5]">
                Выученные слова · {learnedCount}
                <span className="text-[#c9a96e] transition group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ) : (
            <div className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="eyebrow">Архив</span>
              <span className="text-[#6f6a61]">Выученные слова появятся здесь</span>
            </div>
          )}
        </footer>

        <TelegramBanner />
      </div>
    </div>
  )
}
