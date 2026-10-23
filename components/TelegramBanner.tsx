'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

type BotInfo = {
  connected: boolean
  botUrl: string | null
}

export default function TelegramBanner() {
  const { user, loading } = useAuth()
  const router = useRouter()

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
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) return

        const res = await fetch('/api/telegram/link', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
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
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        popup?.close()
        router.push('/login')
        return
      }

      const res = await fetch('/api/telegram/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
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
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }

      const res = await fetch('/api/telegram/link', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
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
    <section className="mt-3 grid gap-2 md:grid-cols-[1.05fr_0.95fr]">
      <div className="panel flex flex-col justify-between gap-5 p-5">
        <div>
          <p className="eyebrow">Telegram</p>
          <h2 className="mt-2 text-2xl">Повторяйте слова в мессенджере</h2>
          <p className="mt-2.5 max-w-md text-sm leading-6 text-[#b5aea1]">
            Бот присылает сложные слова из ваших папок и сохраняет прогресс после
            каждого ответа. Подключение занимает пару секунд — регистрация не нужна.
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={connect}
              disabled={connecting || checking || disconnecting}
              className="btn btn-primary"
            >
              {connecting
                ? 'Готовим ссылку...'
                : info.connected
                  ? 'Открыть бота'
                  : 'Подключить бота'}
            </button>
            {info.connected && (
              <>
                <span className="text-[10px] uppercase tracking-[0.16em] text-[#9fb59f]">
                  уже подключён
                </span>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={disconnecting || connecting}
                  className="btn btn-ghost !px-0 !py-0 text-[10px] text-[#bb7464] hover:text-[#d9a093]"
                >
                  {disconnecting ? 'Отвязываем...' : 'Отвязать Telegram'}
                </button>
              </>
            )}
          </div>

          {notice && (
            <p className="mt-3 border border-[#9fb59f]/40 bg-[#9fb59f]/10 px-3 py-2 text-xs text-[#b9c9b8]">
              {notice}
            </p>
          )}

          {error && (
            <p className="mt-3 border border-[#bb7464]/50 bg-[#bb7464]/10 px-3 py-2 text-xs text-[#d9a093]">
              {error}
            </p>
          )}

          <p className="mt-3 text-[10px] leading-4 text-[#6f6a61]">
            Откроется Telegram и привяжет бота к вашему аккаунту на сайте.
          </p>
        </div>
      </div>

      <div className="panel p-5">
        <p className="eyebrow">Как это работает</p>
        <div className="mt-3 space-y-3 text-sm leading-6 text-[#b5aea1]">
          <p>
            <span className="text-[#f2eee5]">Окно</span> — время, когда бот присылает
            слова. Например, 09:00–21:00.
          </p>
          <p>
            <span className="text-[#f2eee5]">Интервал</span> — пауза между обычными
            словами. Например, каждые 60 минут.
          </p>
          <p>
            <span className="text-[#f2eee5]">«Не знаю»</span> — слово вернётся через
            15 минут, 2 и 5 часов, затем через 1, 2, 4, 7, 15 и 30 дней.
          </p>
          <p>
            Перевод можно скрыть под спойлером, а ненужное слово — отключить кнопкой
            «Больше не повторять».
          </p>
          <p>
            Окно, интервал и часовой пояс меняются кнопкой «Настройки» прямо в боте.
          </p>
        </div>
      </div>
    </section>
  )
}
