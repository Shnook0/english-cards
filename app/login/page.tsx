'use client'

import { useState } from 'react'
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

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка при авторизации')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1115] p-4 text-[#e6e8ec]">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-[#1a1d23] p-8 shadow-xl">
        <h1 className="mb-6 text-center text-2xl font-bold">
          {isResetMode
            ? 'Восстановление пароля'
            : isSignUp
            ? 'Регистрация'
            : 'Вход в аккаунт'}
        </h1>

        {error && (
          <div className="mb-4 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm text-[#e6e8ec]">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 rounded-lg bg-green-500/20 border border-green-500 p-3 text-sm text-green-300">
            {message}
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#8b90a0]">
              Email
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full rounded-lg border border-gray-700 bg-[#0f1115] p-3 text-[#e6e8ec] outline-none focus:border-[#6c7cff]"
            />
          </div>

          {!isResetMode && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[#8b90a0]">
                Пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  className="w-full rounded-lg border border-gray-700 bg-[#0f1115] p-3 pr-10 text-[#e6e8ec] outline-none focus:border-[#6c7cff]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8b90a0] hover:text-[#e6e8ec] transition"
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
            disabled={loading}
            className="w-full rounded-lg bg-[#6c7cff] py-3 font-medium text-white hover:bg-[#5865e0] transition disabled:opacity-50"
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

        <div className="mt-6 flex flex-col items-center gap-2 text-sm text-[#8b90a0]">
          {!isResetMode && (
            <button
              type="button"
              onClick={() => {
                setIsResetMode(true)
                setError(null)
                setMessage(null)
              }}
              className="hover:text-[#e6e8ec] transition"
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
            className="text-[#6c7cff] hover:underline"
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