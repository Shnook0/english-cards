'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="page-in w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="eyebrow mb-4">English Cards</p>
          <h1 className="display text-5xl">
            {isResetMode
              ? 'Восстановление'
              : isSignUp
              ? 'Регистрация'
              : 'Вход в аккаунт'}
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#948e82]">
            {isResetMode
              ? 'Пришлём ссылку для нового пароля.'
              : 'Личный лексикон, который остаётся с вами.'}
          </p>
        </div>

        <div className="panel p-7 md:p-9">
          {error && (
            <div className="mb-5 border border-[#bb7464]/50 bg-[#bb7464]/10 p-4 text-sm text-[#e3b4a8]">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-5 border border-[#9fb59f]/40 bg-[#9fb59f]/10 p-4 text-sm text-[#c2d2c1]">
              {message}
            </div>
          )}

          {!online && (
            <div className="mb-5 border border-[#c9a96e]/40 bg-[#c9a96e]/10 p-4 text-sm text-[#ddc08a]">
              Нет интернета. Если вы уже входили на этом устройстве, откройте главную —
              сохранённые слова и тренировки доступны офлайн.
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-5">
          <div>
            <label className="eyebrow mb-2 block">Email</label>
            <input
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
              <label className="eyebrow mb-2 block">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  className="field pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#948e82] hover:text-[#f2eee5] transition"
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

          <button
            type="submit"
            disabled={loading || !online}
            className="btn btn-primary w-full"
          >
            {loading
              ? 'Загрузка...'
              : isResetMode
              ? 'Отправить ссылку'
              : isSignUp
              ? 'Зарегистрироваться'
              : 'Войти'}
          </button>
          </form>

          <div className="mt-7 flex flex-col items-center gap-3 border-t border-[#24221e] pt-5 text-sm text-[#948e82]">
            {!isResetMode && (
              <button
                type="button"
                onClick={() => {
                  setIsResetMode(true)
                  setError(null)
                  setMessage(null)
                }}
                className="link-muted"
              >
                Забыли пароль?
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setIsResetMode(false)
                setError(null)
                setMessage(null)
              }}
              className="text-[#c9a96e] hover:text-[#ddc08a]"
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
    </div>
  )
}