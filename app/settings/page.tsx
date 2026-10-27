'use client'

import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
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
import PageHeader from '@/components/ui/PageHeader'
import Icon, { type IconName } from '@/components/ui/Icon'

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

type Tone = 'accent' | 'success' | 'danger' | 'warning'

// Строка настроек в стиле iOS: иконка, название и пояснение слева, статус или кнопка справа.
function SettingsRow({
  icon,
  tone = 'accent',
  title,
  text,
  children,
}: {
  icon: IconName
  tone?: Tone
  title: ReactNode
  text?: ReactNode
  children?: ReactNode
}) {
  const toneClass = tone === 'accent' ? '' : ` tile-icon-${tone}`
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className={`tile-icon${toneClass}`} style={{ width: 36, height: 36, borderRadius: 10 }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-5 text-[#ececf1]">{title}</p>
        {text && <p className="mt-0.5 text-[13px] leading-[18px] text-[#8a8a96]">{text}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useOfflineRouter()
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
      const result = await syncNow(user.id, true)
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
      const result = await syncNow(user.id, true)
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
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Загружаем настройки…</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <span className="eyebrow">Нужно войти в аккаунт</span>
      </div>
    )
  }

  const isBusy = busy !== null
  const allClear = sync.pending === 0 && failed === 0 && conflicts.length === 0

  return (
    <div className="page page-in">
      <PageHeader
        back={{ href: '/', label: 'Главная' }}
        title="Настройки"
        description="Синхронизация, резервная копия и установка на iPhone. Слова и тренировки работают и без интернета."
      />

      {/* ── Синхронизация ─────────────────────────────── */}
      <h2 className="section-label">Синхронизация</h2>
      <section className="card divide-y divide-[#24242b]">
        <SettingsRow
          icon={sync.online ? 'cloud' : 'info'}
          tone={sync.online ? 'success' : 'accent'}
          title="Соединение"
          text={sync.online ? 'Изменения отправляются сразу' : 'Всё сохраняется на устройстве'}
        >
          <span className={`chip ${sync.online ? 'chip-success' : 'chip-accent'}`}>
            {sync.online ? 'Онлайн' : 'Офлайн'}
          </span>
        </SettingsRow>

        <SettingsRow
          icon="send"
          title="Ждут отправки"
          text={`${plural(sync.pending, 'Изменение', 'Изменения', 'Изменений')} в очереди`}
        >
          <span className={`chip ${sync.pending > 0 ? 'chip-accent' : ''}`}>{sync.pending}</span>
        </SettingsRow>

        <SettingsRow
          icon="target"
          tone={failed > 0 ? 'danger' : 'accent'}
          title="Ошибки отправки"
          text={failed > 0 ? 'Можно повторить вручную' : 'Нет неудачных отправок'}
        >
          <span className={`chip ${failed > 0 ? 'chip-danger' : ''}`}>{failed}</span>
        </SettingsRow>

        <SettingsRow
          icon="layers"
          tone={conflicts.length > 0 ? 'danger' : 'accent'}
          title="Конфликты"
          text={conflicts.length > 0 ? 'Нужно выбрать версию — см. ниже' : 'Нет расхождений'}
        >
          <span className={`chip ${conflicts.length > 0 ? 'chip-danger' : ''}`}>
            {conflicts.length}
          </span>
        </SettingsRow>

        <SettingsRow icon="check" title="Последняя синхронизация" text={formatDate(sync.lastSyncAt)} />

        <SettingsRow
          icon="phone"
          tone={persisted === false ? 'warning' : persisted ? 'success' : 'accent'}
          title="Хранилище на устройстве"
          text={
            persisted === null
              ? 'Проверяем…'
              : persisted
                ? 'Защищено от очистки'
                : 'Может быть очищено системой'
          }
        />

        <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:px-5">
          <button
            type="button"
            onClick={runSync}
            disabled={isBusy || !sync.online}
            className="btn btn-primary sm:flex-1"
          >
            {busy === 'sync' ? 'Синхронизируем…' : 'Синхронизировать сейчас'}
          </button>
          <button
            type="button"
            onClick={retryFailed}
            disabled={isBusy || failed === 0}
            className="btn btn-secondary sm:flex-1"
          >
            {busy === 'retry' ? 'Повторяем…' : 'Повторить ошибки'}
          </button>
        </div>
      </section>

      {allClear && !message && (
        <p className="mt-3 flex items-center gap-2 px-1 text-[13px] text-[#7fc8a0]">
          <Icon name="check" size={16} />
          Все данные синхронизированы. Можно тренироваться офлайн.
        </p>
      )}

      {message && (
        <div
          role="status"
          className={`mt-3 rounded-xl border px-4 py-3 text-sm leading-5 ${
            message.tone === 'ok'
              ? 'border-[#7fc8a0]/40 bg-[#7fc8a0]/10 text-[#a9ddc0]'
              : message.tone === 'info'
                ? 'border-[#8ea2ff]/40 bg-[#8ea2ff]/10 text-[#a8b8ff]'
                : 'border-[#e5786f]/40 bg-[#e5786f]/10 text-[#f0a39b]'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Конфликты ─────────────────────────────────── */}
      {conflicts.length > 0 && (
        <>
          <h2 className="section-label flex items-center gap-2">
            Конфликты изменений
            <span className="chip chip-danger">{conflicts.length}</span>
          </h2>
          <div className="hint mb-3">
            <Icon name="info" size={18} />
            <p>
              Слово изменили на другом устройстве. Выберите, какую версию оставить.
              «Объединить» сохранит предложения из обеих.
            </p>
          </div>

          <div className="space-y-3">
            {conflicts.map(conflict => {
              const id = conflict.id
              const word = conflict.local.word || conflict.remote.word
              const localSentences = conflict.local.sentences ?? []
              const remoteSentences = conflict.remote.sentences ?? []
              const disabled = isBusy || resolving !== null || id === undefined

              return (
                <article key={id ?? conflict.entityId} className="card p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg leading-6">{word}</h3>
                      <p className="mt-0.5 text-[13px] text-[#6b6b76]">
                        {conflict.remote.transcription || 'без транскрипции'}
                      </p>
                    </div>
                    <span className="chip chip-danger">Конфликт</span>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#8ea2ff]/30 bg-[#8ea2ff]/[0.06] p-3">
                      <p className="text-[13px] font-medium text-[#8ea2ff]">Моя версия</p>
                      <p className="mt-1.5 text-[15px] text-[#ececf1]">
                        {conflict.local.translation || '—'}
                      </p>
                      {localSentences.length > 0 && (
                        <p className="mt-1.5 text-[13px] leading-5 text-[#8a8a96]">
                          {localSentences.slice(0, 2).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-[#24242b] bg-[#1b1b21] p-3">
                      <p className="text-[13px] font-medium text-[#b0b0bb]">Версия на сервере</p>
                      <p className="mt-1.5 text-[15px] text-[#ececf1]">{conflict.remote.translation}</p>
                      {remoteSentences.length > 0 && (
                        <p className="mt-1.5 text-[13px] leading-5 text-[#8a8a96]">
                          {remoteSentences.slice(0, 2).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => id !== undefined && handleResolve(id, 'mine')}
                      disabled={disabled || !sync.online}
                      className="btn btn-primary btn-sm"
                    >
                      {resolving === id ? 'Сохраняем…' : 'Оставить мою'}
                    </button>
                    <button
                      type="button"
                      onClick={() => id !== undefined && handleResolve(id, 'merge')}
                      disabled={disabled || !sync.online}
                      className="btn btn-secondary btn-sm"
                    >
                      Объединить
                    </button>
                    <button
                      type="button"
                      onClick={() => id !== undefined && handleResolve(id, 'server')}
                      disabled={disabled}
                      className="btn btn-secondary btn-sm"
                    >
                      Взять с сервера
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      {/* ── Резервная копия ───────────────────────────── */}
      <h2 className="section-label">Резервная копия</h2>
      <section className="card divide-y divide-[#24242b]">
        <SettingsRow
          icon="download"
          tone="success"
          title="Скачать копию"
          text="Слова, папки, тренировки, прогресс и рекорды в одном файле. Работает офлайн."
        >
          <button
            type="button"
            onClick={handleExport}
            disabled={isBusy}
            className="btn btn-secondary btn-sm"
          >
            {busy === 'export' ? 'Готовим…' : 'Скачать'}
          </button>
        </SettingsRow>

        <SettingsRow
          icon="upload"
          tone="warning"
          title="Восстановить из файла"
          text="Заменит данные на устройстве и в аккаунте. Нужен интернет."
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || !sync.online}
            className="btn btn-secondary btn-sm"
          >
            {busy === 'restore' ? 'Восстанавливаем…' : 'Выбрать файл'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
        </SettingsRow>
      </section>
      {!sync.online && (
        <p className="mt-2 px-1 text-[13px] leading-5 text-[#8ea2ff]">
          Скачать копию можно офлайн. Для восстановления подключитесь к интернету.
        </p>
      )}

      {/* ── Установка на iPhone ───────────────────────── */}
      <h2 className="section-label">Установка на iPhone</h2>
      <ol className="card divide-y divide-[#24242b]">
        {INSTALL_STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#8ea2ff]/12 text-[13px] font-semibold text-[#8ea2ff]">
              {index + 1}
            </span>
            <p className="pt-0.5 text-[15px] leading-6 text-[#ececf1]">{step}</p>
          </li>
        ))}
      </ol>
      <div className="hint mt-3">
        <Icon name="info" size={18} />
        <p>
          iOS может очищать данные редко открываемых сайтов — периодически скачивайте резервную
          копию. Полноценное приложение получится только из Safari.
        </p>
      </div>
    </div>
  )
}

const INSTALL_STEPS = [
  'Откройте сайт в Safari.',
  'Нажмите «Поделиться» → «На экран „Домой“».',
  'Запускайте с иконки — откроется без адресной строки.',
  'Перед выходом без интернета дождитесь синхронизации или включите авиарежим.',
]
