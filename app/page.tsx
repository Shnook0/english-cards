'use client'

import { useEffect, useState } from 'react'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Folder } from '@/types/database'
import TelegramBanner from '@/components/TelegramBanner'
import Icon from '@/components/ui/Icon'
import { fetchCards, fetchFolders, getPendingCount } from '@/lib/offline/repo'
import { clearLocalData } from '@/lib/offline/db'

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
  const router = useOfflineRouter()

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

      const [list, learnedCards, favoriteCards, mistakeCards] = await Promise.all([
        fetchFolders(user.id),
        fetchCards({ userId: user.id, learned: true }),
        fetchCards({ userId: user.id, favorite: true }),
        fetchCards({ userId: user.id, mistakes: true }),
      ])

      if (cancelled) return

      setFolders(list)
      setLearnedFolder(list.find(folder => folder.type === 'learned') ?? null)
      setLearnedCount(learnedCards.length)
      setFavoritesCount(favoriteCards.length)
      setMistakesCount(mistakeCards.length)
      setLoadingData(false)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user])

  const logout = async () => {
    const pending = await getPendingCount().catch(() => 0)
    if (
      pending > 0 &&
      !confirm(
        `На устройстве есть несохранённые изменения (${pending}). Они будут потеряны при выходе. Выйти?`
      )
    ) {
      return
    }
    try {
      if (navigator.onLine) {
        const { error } = await supabase.auth.signOut()
        if (error) await supabase.auth.signOut({ scope: 'local' })
      } else {
        await supabase.auth.signOut({ scope: 'local' })
      }
    } catch {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    }
    await clearLocalData().catch(() => {})
    router.push('/login')
  }

  if (authLoading || loadingData) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем ваш словарь…</span>
      </div>
    )
  }

  const customFolders = folders.filter(folder => folder.type === 'custom')
  const levelFolders = folders.filter(folder => folder.type === 'level')

  return (
    <div className="page page-in">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">English Cards</p>
          <h1 className="page-title mt-1">Ваш словарь</h1>
        </div>
        <Link href="/settings" className="icon-btn" aria-label="Настройки">
          <Icon name="settings" />
        </Link>
      </header>

      {error && (
        <div className="mt-5 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
          {error}
        </div>
      )}

      <section className="card mt-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Словарный запас</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="stat-number text-[2.75rem]">{learnedCount}</span>
              <span className="text-[15px] text-[#8a8a96]">{wordsLabel(learnedCount)} выучено</span>
            </p>
            <p className="mt-2 text-sm leading-5 text-[#b0b0bb]">{vocabularyPhrase(learnedCount)}</p>
          </div>
          <span className="tile-icon tile-icon-success">
            <Icon name="check" />
          </span>
        </div>

        <Link
          href={mistakesCount > 0 ? '/mistakes' : '/general'}
          className="btn btn-primary btn-lg btn-block mt-5"
        >
          {mistakesCount > 0 ? `Разобрать ошибки · ${mistakesCount}` : 'Начать тренировку'}
          <Icon name="arrowRight" size={18} />
        </Link>
        <p className="mt-2.5 text-center text-xs text-[#6b6b76]">
          {mistakesCount > 0
            ? 'Начните со слов, в которых вы чаще всего ошибаетесь'
            : 'Повторение слов из всех ваших папок'}
        </p>
      </section>

      <h2 className="section-label">Разделы</h2>
      <section className="grid grid-cols-2 gap-3">
        <Link href="/folders" className="tile">
          <span className="tile-icon">
            <Icon name="folder" />
          </span>
          <div>
            <p className="tile-title">Мои папки</p>
            <p className="tile-text">Слова по темам · {customFolders.length}</p>
          </div>
        </Link>

        <Link href="/general" className="tile">
          <span className="tile-icon">
            <Icon name="spark" />
          </span>
          <div>
            <p className="tile-title">Тренировка</p>
            <p className="tile-text">Слова из всех папок вперемешку</p>
          </div>
        </Link>

        <Link href="/mistakes" className="tile">
          <span className="tile-icon tile-icon-danger">
            <Icon name="target" />
          </span>
          <div>
            <p className="tile-title">Частые ошибки</p>
            <p className="tile-text">Ошибались 2+ раза · {mistakesCount}</p>
          </div>
        </Link>

        <Link href="/favorites" className="tile">
          <span className="tile-icon tile-icon-warning">
            <Icon name="star" />
          </span>
          <div>
            <p className="tile-title">Избранное</p>
            <p className="tile-text">Слова со звёздочкой · {favoritesCount}</p>
          </div>
        </Link>

        <Link href="/levels" className="tile">
          <span className="tile-icon">
            <Icon name="layers" />
          </span>
          <div>
            <p className="tile-title">Уровни A1–C2</p>
            <p className="tile-text">Готовые наборы · {levelFolders.length}</p>
          </div>
        </Link>

        {learnedFolder ? (
          <Link href={`/folder/${learnedFolder.id}`} className="tile">
            <span className="tile-icon tile-icon-success">
              <Icon name="book" />
            </span>
            <div>
              <p className="tile-title">Выученные</p>
              <p className="tile-text">Архив знакомых слов · {learnedCount}</p>
            </div>
          </Link>
        ) : (
          <div className="tile opacity-60">
            <span className="tile-icon tile-icon-success">
              <Icon name="book" />
            </span>
            <div>
              <p className="tile-title">Выученные</p>
              <p className="tile-text">Появятся после первых тренировок</p>
            </div>
          </div>
        )}
      </section>

      <h2 className="section-label">Как это работает</h2>
      <ol className="card divide-y divide-[#24242b]">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="flex gap-4 px-5 py-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8ea2ff]/12 text-[13px] font-semibold text-[#8ea2ff]">
              {index + 1}
            </span>
            <div>
              <p className="text-[15px] font-semibold">{step.title}</p>
              <p className="mt-1 text-sm leading-5 text-[#8a8a96]">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        <TelegramBanner />
      </div>

      <footer className="mt-8 flex flex-col items-center gap-2 text-center">
        {user?.email && <p className="text-xs text-[#6b6b76]">Вы вошли как {user.email}</p>}
        <button onClick={logout} className="btn btn-ghost btn-sm">
          <Icon name="logout" size={16} />
          Выйти из аккаунта
        </button>
      </footer>
    </div>
  )
}

const HOW_IT_WORKS = [
  {
    title: 'Соберите слова в папки',
    text: 'Создайте папку по теме и добавьте слова — перевод подскажем сами.',
  },
  {
    title: 'Тренируйтесь',
    text: '«Знаю» — слово вернётся реже. «Не знаю» — чаще. Три «Знаю» подряд — и слово выучено.',
  },
  {
    title: 'Повторяйте в Telegram',
    text: 'Бот присылает сложные слова в удобное время — без открытия сайта.',
  },
  {
    title: 'Работает без интернета',
    text: 'Ответы сохраняются на телефоне и отправятся сами, когда появится сеть.',
  },
]

function wordsLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'слово'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'слова'
  return 'слов'
}