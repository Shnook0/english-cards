'use client'

import { useState } from 'react'
import { Card } from '@/types/database'
import Icon from '@/components/ui/Icon'
import { useRuPronunciation } from '@/hooks/useRuPronunciation'
import { cleanWord, knownPronunciation } from '@/lib/pronounce'
import { fetchPronunciations } from '@/lib/pronounceClient'

// Выгрузка слов папки в том же формате, что и импорт «Списком»:
// слово | транскрипция | [произношение] | перевод | примеры
// Такой текст можно сразу вставить обратно в «Добавить слова → Списком».

function field(value: string | null | undefined): string {
  return (value ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim()
}

async function buildExportText(cards: Card[], withPron: boolean): Promise<string> {
  let fetched: Record<string, string> = {}
  if (withPron) {
    const missing = cards.filter(card => !knownPronunciation(card)).map(card => card.word)
    if (missing.length > 0) fetched = await fetchPronunciations(missing).catch((): Record<string, string> => ({}))
  }

  return cards
    .map(card => {
      const word = field(cleanWord(card.word))
      const parts = [word]
      const ipa = field(card.transcription)
      if (ipa) {
        // импорт узнаёт транскрипцию по / или [ — без них она стала бы переводом
        parts.push(/^[/[]|[/\]]$/.test(ipa) ? ipa : `[${ipa}]`)
      }
      if (withPron) {
        const pron = knownPronunciation(card) ?? fetched[word.toLowerCase()] ?? ''
        if (pron.trim()) parts.push(field(pron))
      }
      parts.push(field(card.translation))
      for (const sentence of card.sentences ?? []) {
        if (sentence.trim()) parts.push(field(sentence))
      }
      return parts.join(' | ')
    })
    .join('\n')
}

function fileName(folderName: string): string {
  const base = folderName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${base || 'слова'}.txt`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // старые браузеры и http: через временное поле
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

export default function ExportWords({ cards, folderName }: { cards: Card[]; folderName: string }) {
  const [ruEnabled] = useRuPronunciation()
  const [busy, setBusy] = useState<'copy' | 'file' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  if (cards.length === 0) return null

  const run = async (kind: 'copy' | 'file') => {
    setBusy(kind)
    setMessage(null)
    try {
      const text = await buildExportText(cards, ruEnabled)
      if (kind === 'copy') {
        const ok = await copyText(text)
        setMessage(
          ok
            ? { ok: true, text: `Скопировано слов: ${cards.length}` }
            : { ok: false, text: 'Не удалось скопировать — попробуйте скачать файл' }
        )
      } else {
        // BOM — чтобы Блокнот на Windows сразу открыл кириллицу правильно
        const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName(folderName)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setMessage({ ok: true, text: `Файл с ${cards.length} словами сохранён` })
      }
    } catch {
      setMessage({ ok: false, text: 'Не получилось выгрузить слова' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => run('copy')}
          disabled={busy !== null}
          className="btn btn-secondary btn-sm"
        >
          <Icon name="check" size={16} />
          {busy === 'copy' ? 'Копирую…' : 'Скопировать слова'}
        </button>
        <button
          type="button"
          onClick={() => run('file')}
          disabled={busy !== null}
          className="btn btn-secondary btn-sm"
        >
          <Icon name="download" size={16} />
          {busy === 'file' ? 'Готовлю…' : 'Скачать .txt'}
        </button>
      </div>
      <p className={`mt-1.5 text-xs ${message ? (message.ok ? 'text-[#7fc8a0]' : 'text-[#e5786f]') : 'text-[#6b6b76]'}`}>
        {message?.text ?? 'В формате импорта «Списком» — можно вставить в другую папку.'}
      </p>
    </div>
  )
}
