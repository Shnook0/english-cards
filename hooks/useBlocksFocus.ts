'use client'

import { useCallback, useSyncExternalStore } from 'react'

// «Больше игры, меньше слов»: слово в «Блоках» появляется раз в 7–10 ходов вместо 3–5.
// Настройка хранится на устройстве. По умолчанию выключена.
const KEY = 'english-cards:blocks-focus'
const EVENT = 'english-cards:blocks-focus-change'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
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

export function useBlocksFocus(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => false)

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
