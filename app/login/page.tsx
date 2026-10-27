'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import Icon from '@/components/ui/Icon'

export default function LoginPage() {
  const router = useOfflineRouter()
  const [isSignUp, setIsSignUp] = useState(false)
  const [isResetMode, setIsResetMode] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!navigator.onLine) {
      setError('Нет интернета. Вход, регистрация и сброс пароля недоступны офлайн.')
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (isResetMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setMessage('Ссылка для сброса пароля отправлена на ваш Email.')
      } else if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw error
        setMessage('Регистрация успешна! Теперь войдите.')
        setTimeout(() => {
          setIsSignUp(false)
        }, 1500)
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        router.push('/')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Произошла ошибка при авторизации'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="page-in w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="tile-icon" style={{ width: 56, height: 56, borderRadius: 16 }}>
            <Icon name="book" size={26} />
          </span>
          <p className="mt-4 text-[15px] font-semibold text-[#b0b0bb]">English Cards</p>
          <h1 className="page-title mt-1">
            {isResetMode
              ? 'Восстановление'
              : isSignUp
              ? 'Регистрация'
              : 'Вход в аккаунт'}
          </h1>
          <p className="mt-2 text-[15px] leading-6 text-[#8a8a96]">
            {isResetMode
              ? 'Пришлём на почту ссылку для нового пароля.'
              : 'Карточки для английских слов: собирайте, тренируйте, запоминайте.'}
          </p>
        </div>

        <div className="card p-5 sm:p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm leading-5 text-[#f0a39b]">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 rounded-xl border border-[#7fc8a0]/40 bg-[#7fc8a0]/10 px-4 py-3 text-sm leading-5 text-[#a9ddc0]">
              {message}
            </div>
          )}

          {!online && (
            <div className="hint mb-4">
              <Icon name="info" size={18} />
              <p>
                Нет интернета. Если вы уже входили на этом устройстве, откройте главную —
                сохранённые слова и тренировки доступны офлайн.
              </p>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="field"
              />
            </div>

            {!isResetMode && (
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                  Пароль
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    className="field pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[#8a8a96] hover:text-[#ececf1]"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12c1.274 4.057 5.065 7 9.964 7 4.899 0 8.69-2.943 9.964-7-1.274-4.057-5.065-7-9.964-7-4.899 0-8.69 2.943-9.964 7z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || !online}
                className="btn btn-primary btn-lg btn-block"
              >
                {loading
                  ? 'Загрузка…'
                  : isResetMode
                  ? 'Отправить ссылку'
                  : isSignUp
                  ? 'Зарегистрироваться'
                  : 'Войти'}
              </button>
            </div>
          </form>

          {!isResetMode && (
            <button
              type="button"
              onClick={() => {
                setIsResetMode(true)
                setError(null)
                setMessage(null)
              }}
              className="btn btn-ghost btn-sm btn-block mt-2"
            >
              Забыли пароль?
            </button>
          )}
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp)
              setIsResetMode(false)
              setError(null)
              setMessage(null)
            }}
            className="btn btn-block text-[#8ea2ff] hover:bg-[#1b1b21] hover:text-[#a8b8ff]"
          >
            {isResetMode
              ? 'Вернуться ко входу'
              : isSignUp
              ? 'Уже есть аккаунт? Войти'
              : 'Нет аккаунта? Зарегистрироваться'}
          </button>
        </div>
      </div>
    </div>
  )
}
