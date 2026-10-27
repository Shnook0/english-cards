'use client'

import { useEffect, useState } from 'react'
import { getAccessToken } from '@/lib/offline/authCache'
import { isOnline } from '@/lib/offline/connectivity'
import Icon from '@/components/ui/Icon'
import { useAuth } from '@/hooks/useAuth'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'

type BotInfo = {
  connected: boolean
  botUrl: string | null
}

export default function TelegramBanner() {
  const { user, loading } = useAuth()
  const router = useOfflineRouter()

  const [info, setInfo] = useState<BotInfo>({ connected: false, botUrl: null })
  const [checking, setChecking] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (loading || !user) return

    let cancelled = false

    const load = async () => {
      setChecking(true)
      try {
        const token = await getAccessToken()
        if (!token) return

        const res = await fetch('/api/telegram/link', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        })
        const data = await res.json()
        if (!cancelled && res.ok) {
          setInfo({
            connected: Boolean(data.connected),
            botUrl: typeof data.botUrl === 'string' ? data.botUrl : null,
          })
        }
      } catch {
        // Не мешаем главной странице, если бот временно недоступен.
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user, loading])

  const connect = async () => {
    if (!user) {
      router.push('/login')
      return
    }

    setConnecting(true)
    setError(null)
    setNotice(null)

    const popup = window.open('about:blank', '_blank')

    try {
      const token = await getAccessToken()
      if (!token) {
        popup?.close()
        if (!isOnline()) {
          setError('Нужен интернет, чтобы подключить бота.')
          return
        }
        router.push('/login')
        return
      }

      const res = await fetch('/api/telegram/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (!res.ok || !data.botUrl) {
        throw new Error(data.error || 'Не удалось получить ссылку на бота')
      }

      if (popup) {
        popup.opener = null
        popup.location.href = data.botUrl as string
      } else {
        window.location.href = data.botUrl as string
      }

      setInfo(previous => ({ ...previous, botUrl: data.botUrl as string }))
    } catch (err) {
      popup?.close()
      setError(err instanceof Error ? err.message : 'Не удалось открыть бота')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    if (!user) return
    if (
      !window.confirm(
        'Отвязать Telegram-аккаунт? Бот перестанет присылать слова, прогресс на сайте сохранится.'
      )
    ) {
      return
    }

    setDisconnecting(true)
    setError(null)
    setNotice(null)

    try {
      const token = await getAccessToken()
      if (!token) {
        if (!isOnline()) {
          setError('Нужен интернет, чтобы отвязать бота.')
          return
        }
        router.push('/login')
        return
      }

      const res = await fetch('/api/telegram/link', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отвязать Telegram')
      }

      setInfo(previous => ({ ...previous, connected: false }))
      setNotice(
        'Telegram отвязан. Теперь аккаунт можно привязать к другому Telegram-аккаунту.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отвязать Telegram')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start gap-4">
        <span className="tile-icon">
          <Icon name="send" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px]">Telegram-бот</h2>
            {info.connected && <span className="chip chip-success">подключён</span>}
          </div>
          <p className="mt-1 text-sm leading-5 text-[#8a8a96]">
            Присылает сложные слова из ваших папок в удобное время. Ответы сохраняются
            в прогресс на сайте.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={connect}
          disabled={connecting || checking || disconnecting}
          className="btn btn-primary flex-1 sm:flex-none"
        >
          {connecting
            ? 'Готовим ссылку...'
            : info.connected
              ? 'Открыть бота'
              : 'Подключить бота'}
        </button>
        {info.connected && (
          <button
            type="button"
            onClick={disconnect}
            disabled={disconnecting || connecting}
            className="btn btn-ghost"
          >
            {disconnecting ? 'Отвязываем...' : 'Отвязать'}
          </button>
        )}
      </div>

      {notice && (
        <p className="mt-3 rounded-xl bg-[#7fc8a0]/10 px-3 py-2 text-sm text-[#a9ddc0]">{notice}</p>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-[#e5786f]/10 px-3 py-2 text-sm text-[#f0a39b]">{error}</p>
      )}

      <details className="group mt-4 border-t border-[#24242b] pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm font-medium text-[#b0b0bb] [&::-webkit-details-marker]:hidden">
          Как работает бот
          <Icon name="arrowRight" size={16} className="transition group-open:rotate-90" />
        </summary>
        <dl className="mt-3 space-y-3">
          {BOT_FAQ.map(item => (
            <div key={item.title}>
              <dt className="text-sm font-medium">{item.title}</dt>
              <dd className="mt-0.5 text-sm leading-5 text-[#8a8a96]">{item.text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}

const BOT_FAQ = [
  {
    title: 'Подключение',
    text: 'Нажмите «Подключить бота» — откроется Telegram и привяжет бота к вашему аккаунту. Регистрация не нужна.',
  },
  {
    title: 'Когда приходят слова',
    text: 'Окно и интервал настраиваются в боте кнопкой «Настройки». Например, с 09:00 до 21:00 каждые 60 минут.',
  },
  {
    title: 'Кнопка «Не знаю»',
    text: 'Слово придёт чаще: через 15 минут, 2 и 5 часов, затем через 1, 2, 4, 7, 15 и 30 дней.',
  },
  {
    title: 'Кнопка «Знаю»',
    text: 'Слово станет знакомым и будет приходить реже.',
  },
  {
    title: 'Лишние слова',
    text: 'Кнопка «Больше не повторять» отключит слово в боте, в папке оно останется.',
  },
]