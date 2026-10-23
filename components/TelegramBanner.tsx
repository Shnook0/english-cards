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
    <section className="panel mt-3 p-6 md:p-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow">Telegram</p>
          <h2 className="mt-2 text-2xl md:text-3xl">Повторяйте слова в мессенджере</h2>
          <p className="mt-3 text-sm leading-6 text-[#b5aea1]">
            Бот присылает сложные слова из ваших папок, помогает повторять их и
            увеличивать ваш словарный запас. Прогресс сохраняется после каждого
            ответа. Подключение занимает пару секунд — регистрация не нужна.
          </p>
        </div>

        <div className="shrink-0">
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

          <p className="mt-3 max-w-[260px] text-[10px] leading-4 text-[#6f6a61]">
            Откроется Telegram и привяжет бота к вашему аккаунту на сайте.
          </p>
        </div>
      </div>

      <div className="mt-7 border-t border-[#24221e] pt-6">
        <p className="eyebrow">Как это работает</p>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Слова из ваших папок</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Бот берёт слова с сайта и присылает их в удобное для вас время.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Окно и интервал</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Настройте, когда и как часто приходят слова. Например, с 09:00 до
              21:00 каждые 60 минут.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Кнопка «Не знаю»</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Слово начнёт приходить чаще: через 15 минут, 2 и 5 часов, затем через
              1, 2, 4, 7, 15 и 30 дней.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Кнопка «Знаю»</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Бот отметит слово как знакомое и будет повторять его реже. Прогресс
              сохраняется автоматически.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Перевод и лишние слова</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Перевод можно скрыть под спойлером, а ненужное слово — отключить
              кнопкой «Больше не повторять». В папке оно останется.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-[#f2eee5]">Настройки в боте</p>
            <p className="mt-1 text-sm leading-6 text-[#b5aea1]">
              Окно, интервал и часовой пояс меняются кнопкой «Настройки» прямо в
              Telegram.
            </p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-5 text-[#6f6a61]">
          Нажмите «Подключить бота» — Telegram откроется автоматически, и бот
          привяжется к вашему аккаунту.
        </p>
      </div>
    </section>
  )
}
