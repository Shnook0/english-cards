'use client'

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { ConflictItem, SyncState } from '@/types/offline'
import {
  downloadBackup,
  exportBackup,
  getFailedCount,
  getSyncState,
  isOnline,
  listConflicts,
  resolveConflict,
  restoreBackup,
  retryFailedOutbox,
  subscribeConnectivity,
  syncNow,
} from '@/lib/offline/repo'
import type { SyncResult } from '@/lib/offline/repo'
import { subscribeOutbox } from '@/lib/offline/outbox'

const EMPTY_SYNC: SyncState = {
  status: 'idle',
  online: true,
  pending: 0,
  conflicts: 0,
  lastSyncAt: null,
  error: null,
}

type Busy = 'sync' | 'retry' | 'export' | 'restore' | null

type Message = {
  tone: 'ok' | 'error' | 'info'
  text: string
}

function formatDate(value: string | null): string {
  if (!value) return 'ещё не было'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function syncResultMessage(result: SyncResult): Message {
  if (result.ok) {
    return {
      tone: 'ok',
      text: result.pulled ? 'Синхронизация завершена, данные обновлены.' : 'Все изменения отправлены.',
    }
  }
  if (!isOnline()) {
    return {
      tone: 'info',
      text: 'Нет подключения. Изменения сохранены на устройстве и отправятся позже.',
    }
  }
  if (result.failed > 0) {
    return {
      tone: 'error',
      text: `Не удалось отправить ${result.failed} ${plural(
        result.failed,
        'изменение',
        'изменения',
        'изменений'
      )}. Попробуйте повторить позже.`,
    }
  }
  if (result.conflicts > 0) {
    return {
      tone: 'info',
      text: `Обнаружено ${result.conflicts} ${plural(
        result.conflicts,
        'конфликт',
        'конфликта',
        'конфликтов'
      )}. Выберите версию ниже.`,
    }
  }
  return {
    tone: 'error',
    text: result.error ?? 'Не удалось синхронизировать данные.',
  }
}

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [sync, setSync] = useState<SyncState>(EMPTY_SYNC)
  const [failed, setFailed] = useState(0)
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Busy>(null)
  const [resolving, setResolving] = useState<number | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [user, authLoading, router])

  const refresh = useCallback(async () => {
    if (!user) return
    const [state, failedCount, conflictList] = await Promise.all([
      getSyncState(),
      getFailedCount(),
      listConflicts(),
    ])
    setSync(state)
    setFailed(failedCount)
    setConflicts(conflictList)
  }, [user])

  useEffect(() => {
    if (!user) return

    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        await refresh()
      } catch {
        if (!cancelled) {
          setMessage({ tone: 'error', text: 'Не удалось прочитать локальные данные.' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [user, refresh])

  useEffect(() => {
    if (!user) return
    const unsubscribeConnectivity = subscribeConnectivity(() => {
      void refresh()
    })
    const unsubscribeOutbox = subscribeOutbox(() => {
      void refresh()
    })
    return () => {
      unsubscribeConnectivity()
      unsubscribeOutbox()
    }
  }, [user, refresh])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return
    void navigator.storage
      .persisted()
      .then(setPersisted)
      .catch(() => setPersisted(null))
  }, [])

  const runSync = async () => {
    if (!user || busy) return
    setBusy('sync')
    setMessage(null)
    try {
      const result = await syncNow(user.id)
      await refresh()
      setMessage(syncResultMessage(result))
    } catch {
      setMessage({ tone: 'error', text: 'Не удалось запустить синхронизацию.' })
    } finally {
      setBusy(null)
    }
  }

  const retryFailed = async () => {
    if (!user || busy) return
    setBusy('retry')
    setMessage(null)
    try {
      await retryFailedOutbox()
      const result = await syncNow(user.id)
      await refresh()
      setMessage(syncResultMessage(result))
    } catch {
      setMessage({ tone: 'error', text: 'Не удалось повторить отправку изменений.' })
    } finally {
      setBusy(null)
    }
  }

  const handleExport = async () => {
    if (busy) return
    setBusy('export')
    setMessage(null)
    try {
      const data = await exportBackup()
      downloadBackup(data)
      setMessage({ tone: 'ok', text: 'Резервная копия сохранена в файл.' })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Не удалось создать резервную копию.',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return

    if (!isOnline()) {
      setMessage({ tone: 'error', text: 'Для восстановления из файла нужен интернет.' })
      return
    }

    if (!confirm('Восстановить данные из резервной копии? Текущие данные будут заменены.')) {
      return
    }

    setBusy('restore')
    setMessage(null)
    try {
      await restoreBackup(await file.text())
      await refresh()
      setMessage({
        tone: 'ok',
        text: 'Данные восстановлены. Резервная копия также загружена на сервер.',
      })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Не удалось восстановить данные.',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleResolve = async (id: number, choice: 'mine' | 'server' | 'merge') => {
    if (choice !== 'server' && !isOnline()) {
      setMessage({ tone: 'error', text: 'Для выбора своей версии или объединения нужен интернет.' })
      return
    }

    setResolving(id)
    setMessage(null)
    try {
      const result = await resolveConflict(id, choice)
      if (result.ok) {
        await refresh()
        setMessage({ tone: 'ok', text: 'Конфликт разрешён.' })
      } else {
        setMessage({ tone: 'error', text: result.error ?? 'Не удалось разрешить конфликт.' })
      }
    } catch {
      setMessage({ tone: 'error', text: 'Не удалось разрешить конфликт.' })
    } finally {
      setResolving(null)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Загружаем настройки</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-[#948e82]">
        <span className="eyebrow">Нужно войти в аккаунт</span>
      </div>
    )
  }

  const isBusy = busy !== null
  const allClear = sync.pending === 0 && failed === 0 && conflicts.length === 0

  return (
    <div className="min-h-screen p-4 pb-24 md:p-7 lg:p-10">
      <div className="page-in mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="link-muted text-xs uppercase tracking-[0.18em]">
            ← На главную
          </Link>
          <span className="eyebrow">Офлайн-режим</span>
        </div>

        <header className="border-b border-[#24221e] pb-6">
          <p className="eyebrow mb-3">Настройки</p>
          <h1 className="display text-4xl md:text-5xl">Синхронизация</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#948e82]">
            Здесь можно проверить состояние данных, разрешить конфликты и сохранить резервную
            копию. Тренировки и изменения слов работают без интернета.
          </p>
        </header>

        <section className="grid gap-2 py-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel p-4">
            <p className="eyebrow">Соединение</p>
            <p className={`mt-2 text-lg ${sync.online ? 'text-[#9fb59f]' : 'text-[#c9a96e]'}`}>
              {sync.online ? 'Онлайн' : 'Офлайн'}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f6a61]">
              {sync.online ? 'Изменения отправляются сразу' : 'Всё сохраняется на устройстве'}
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow">Ожидают отправки</p>
            <p className="stat-number mt-2 text-[#f2eee5]">{sync.pending}</p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f6a61]">
              {plural(sync.pending, 'изменение', 'изменения', 'изменений')} в очереди
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow">Ошибки</p>
            <p className={`stat-number mt-2 ${failed > 0 ? 'text-[#d9a093]' : 'text-[#f2eee5]'}`}>
              {failed}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f6a61]">
              {failed > 0 ? 'Можно повторить вручную' : 'Нет неудачных отправок'}
            </p>
          </div>

          <div className="panel p-4">
            <p className="eyebrow">Конфликты</p>
            <p className={`stat-number mt-2 ${conflicts.length > 0 ? 'text-[#d9a093]' : 'text-[#f2eee5]'}`}>
              {conflicts.length}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f6a61]">
              {conflicts.length > 0 ? 'Нужно выбрать версию' : 'Нет расхождений'}
            </p>
          </div>
        </section>

        <section className="panel flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="eyebrow">Последняя синхронизация</p>
              <p className="mt-1 text-sm text-[#f2eee5]">{formatDate(sync.lastSyncAt)}</p>
              <p className="mt-1 text-[10px] text-[#6f6a61]">
                Локальное хранилище:{' '}
                {persisted === null ? 'проверяем…' : persisted ? 'защищено от очистки' : 'может быть очищено системой'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runSync}
                disabled={isBusy || !sync.online}
                className="btn btn-primary"
              >
                {busy === 'sync' ? 'Синхронизируем…' : 'Синхронизировать'}
              </button>
              <button
                type="button"
                onClick={retryFailed}
                disabled={isBusy || failed === 0}
                className="btn btn-secondary"
              >
                {busy === 'retry' ? 'Повторяем…' : 'Повторить ошибки'}
              </button>
            </div>
          </div>

          {allClear && !message && (
            <p className="border-t border-[#24221e] pt-4 text-sm text-[#9fb59f]">
              Все данные синхронизированы. Можно тренироваться офлайн.
            </p>
          )}

          {message && (
            <div
              className={`border px-4 py-3 text-sm ${
                message.tone === 'ok'
                  ? 'border-[#9fb59f]/40 bg-[#9fb59f]/10 text-[#c2d2c1]'
                  : message.tone === 'info'
                    ? 'border-[#c9a96e]/40 bg-[#c9a96e]/10 text-[#ddc08a]'
                    : 'border-[#bb7464]/50 bg-[#bb7464]/10 text-[#d9a093]'
              }`}
            >
              {message.text}
            </div>
          )}
        </section>

        {conflicts.length > 0 && (
          <section className="pt-8">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Требует внимания</p>
                <h2 className="mt-1 text-2xl">Конфликты изменений</h2>
              </div>
              <span className="text-xs text-[#948e82]">{conflicts.length}</span>
            </div>

            <div className="space-y-3">
              {conflicts.map(conflict => {
                const id = conflict.id
                const word = conflict.local.word || conflict.remote.word
                const localSentences = conflict.local.sentences ?? []
                const remoteSentences = conflict.remote.sentences ?? []
                const disabled = isBusy || resolving !== null || id === undefined

                return (
                  <article key={id ?? conflict.entityId} className="panel p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl">{word}</h3>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#6f6a61]">
                          {conflict.remote.transcription || 'без транскрипции'}
                        </p>
                      </div>
                      <span className="border border-[#bb7464]/40 bg-[#bb7464]/10 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#d9a093]">
                        Конфликт
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="border border-[#c9a96e]/30 bg-[#c9a96e]/[0.04] p-3">
                        <p className="eyebrow text-[#c9a96e]">Моя версия</p>
                        <p className="mt-2 text-sm text-[#f2eee5]">
                          {conflict.local.translation || '—'}
                        </p>
                        {localSentences.length > 0 && (
                          <p className="mt-2 text-[11px] leading-5 text-[#948e82]">
                            {localSentences.slice(0, 2).join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="border border-[#24221e] bg-black/20 p-3">
                        <p className="eyebrow">Версия сервера</p>
                        <p className="mt-2 text-sm text-[#f2eee5]">{conflict.remote.translation}</p>
                        {remoteSentences.length > 0 && (
                          <p className="mt-2 text-[11px] leading-5 text-[#948e82]">
                            {remoteSentences.slice(0, 2).join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => id !== undefined && handleResolve(id, 'mine')}
                        disabled={disabled || !sync.online}
                        className="btn btn-secondary"
                      >
                        {resolving === id ? 'Сохраняем…' : 'Оставить мою'}
                      </button>
                      <button
                        type="button"
                        onClick={() => id !== undefined && handleResolve(id, 'merge')}
                        disabled={disabled || !sync.online}
                        className="btn btn-secondary"
                      >
                        Объединить
                      </button>
                      <button
                        type="button"
                        onClick={() => id !== undefined && handleResolve(id, 'server')}
                        disabled={disabled}
                        className="btn btn-ghost"
                      >
                        Взять с сервера
                      </button>
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-[#6f6a61]">
                      Конфликт возник, потому что слово изменили на другом устройстве. «Объединить»
                      сохранит оба варианта предложений.
                    </p>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        <section className="pt-8">
          <div className="mb-3">
            <p className="eyebrow">Страховка</p>
            <h2 className="mt-1 text-2xl">Резервная копия</h2>
          </div>
          <div className="panel p-5">
            <p className="text-sm leading-6 text-[#b5aea1]">
              Файл содержит слова, папки, общие тренировки, прогресс и рекорды. Импорт заменяет
              данные на этом устройстве и загружает копию в аккаунт, поэтому выполняется только
              онлайн.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={isBusy}
                className="btn btn-secondary"
              >
                {busy === 'export' ? 'Готовим файл…' : 'Скачать копию'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy || !sync.online}
                className="btn btn-ghost"
              >
                {busy === 'restore' ? 'Восстанавливаем…' : 'Импортировать'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
            {!sync.online && (
              <p className="mt-3 text-[10px] text-[#c9a96e]">
                Скачать копию можно офлайн. Для импорта подключитесь к интернету.
              </p>
            )}
          </div>
        </section>

        <section className="pt-8">
          <div className="mb-3">
            <p className="eyebrow">iPhone</p>
            <h2 className="mt-1 text-2xl">Установка на экран «Домой»</h2>
          </div>
          <div className="panel p-5 text-sm leading-6 text-[#b5aea1]">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Откройте сайт в Safari.</li>
              <li>Нажмите «Поделиться» и выберите «На экран „Домой“».</li>
              <li>Запускайте приложение с иконки — оно откроется без адресной строки.</li>
              <li>Перед выходом без интернета дождитесь синхронизации или включите авиарежим.</li>
            </ol>
            <p className="mt-3 text-[11px] leading-5 text-[#6f6a61]">
              iOS может очищать данные редко используемых сайтов. Периодически скачивайте резервную
              копию. Установка доступна только в Safari; в других браузерах на iPhone добавление на
              экран «Домой» не создаёт полноценное приложение.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
