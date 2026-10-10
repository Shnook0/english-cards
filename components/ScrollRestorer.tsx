'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const PREFIX = 'scroll:'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

type Saved = { y: number; t: number }

// Запоминает прокрутку страницы и возвращает её после перезагрузки
// (например, когда телефон выгрузил свёрнутую вкладку)
export default function ScrollRestorer() {
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  const restoringRef = useRef(false)

  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  // Сохраняем прокрутку: при скролле, при сворачивании вкладки и при закрытии страницы
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const save = () => {
      if (restoringRef.current) return
      try {
        const data: Saved = { y: window.scrollY, t: Date.now() }
        localStorage.setItem(PREFIX + pathRef.current, JSON.stringify(data))
      } catch {
        // хранилище недоступно — просто не запоминаем
      }
    }

    const onScroll = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 150)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', save)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  // Возвращаем прокрутку при загрузке страницы (ждём, пока подгрузится содержимое)
  useEffect(() => {
    let cancelled = false
    let target = 0

    try {
      const raw = localStorage.getItem(PREFIX + pathRef.current)
      if (raw) {
        const saved = JSON.parse(raw) as Saved
        if (Date.now() - saved.t < MAX_AGE_MS) target = saved.y
      }
    } catch {
      target = 0
    }
    if (target <= 0) return

    restoringRef.current = true
    let tries = 0

    const step = () => {
      if (cancelled) return
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      if (maxY >= target - 2 || tries >= 50) {
        window.scrollTo(0, Math.min(target, Math.max(maxY, 0)))
        restoringRef.current = false
        return
      }
      tries++
      setTimeout(step, 100)
    }
    step()

    return () => {
      cancelled = true
      restoringRef.current = false
    }
  }, [])

  return null
}

// конец файла