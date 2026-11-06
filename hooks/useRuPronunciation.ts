'use client'

import { useCallback, useSyncExternalStore } from 'react'

// Настройка хранится на устройстве, как и сортировка слов в папке.
const KEY = 'english-cards:ru-pronunciation'
const EVENT = 'english-cards:ru-pronunciation-change'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useRuPronunciation(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => true)

  const setEnabled = useCallback((value: boolean) => {
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off')
    } catch {
      // без localStorage настройка просто не сохранится
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])

  return [enabled, setEnabled]
}
