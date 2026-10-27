'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useOfflineRouter } from '@/hooks/useOfflineRouter'
import Icon from '@/components/ui/Icon'

export default function ResetPasswordPage() {
  const router = useOfflineRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isRecoveryValid, setIsRecoveryValid] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setIsRecoveryValid(true)
      }
      setIsChecking(false)
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setIsRecoveryValid(true)
      }
      setIsChecking(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    if (password !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({
      password: password,
    })

    setLoading(false)

    if (error) {
      setError('Не удалось обновить пароль: ' + error.message)
    } else {
      setMessage('Пароль обновлён! Перенаправляем на главную...')
      setTimeout(() => {
        router.push('/')
      }, 1500)
    }
  }

  if (isChecking) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-4">
        <span className="eyebrow">Проверяем ссылку…</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="page-in w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span
            className={`tile-icon${isRecoveryValid ? '' : ' tile-icon-danger'}`}
            style={{ width: 56, height: 56, borderRadius: 16 }}
          >
            <Icon name={isRecoveryValid ? 'settings' : 'info'} size={26} />
          </span>
          <p className="mt-4 text-[15px] font-semibold text-[#b0b0bb]">English Cards</p>
          <h1 className="page-title mt-1">Новый пароль</h1>
          <p className="mt-2 text-[15px] leading-6 text-[#8a8a96]">
            {isRecoveryValid
              ? 'Придумайте новый пароль — после сохранения вы сразу попадёте на главную.'
              : 'Ссылка недействительна или устарела. Запросите письмо заново.'}
          </p>
        </div>

        <div className="card p-5 sm:p-6">
          {!isRecoveryValid ? (
            <Link href="/login" className="btn btn-primary btn-lg btn-block">
              Перейти ко входу
              <Icon name="arrowRight" size={18} />
            </Link>
          ) : (
            <form onSubmit={handlePasswordReset} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm leading-5 text-[#f0a39b]">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-xl border border-[#7fc8a0]/40 bg-[#7fc8a0]/10 px-4 py-3 text-sm leading-5 text-[#a9ddc0]">
                  {message}
                </div>
              )}

              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                  Новый пароль
                </label>
                <div className="relative">
                  <input
                    id="new-password"
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

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                  Повторите пароль
                </label>
                <div className="relative">
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Ещё раз, чтобы не ошибиться"
                    className="field pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[#8a8a96] hover:text-[#ececf1]"
                  >
                    {showConfirmPassword ? (
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

              <div className="pt-2">
                <button type="submit" disabled={loading} className="btn btn-primary btn-lg btn-block">
                  {loading ? 'Сохраняем…' : 'Сохранить пароль'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
