'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card } from '@/types/database'

type Props = {
  isOpen: boolean
  onClose: () => void
  folderId: string
  userId: string
  onCardAdded: () => void
  cardToEdit?: Card | null
}

type ParsedCard = {
  word: string
  transcription: string | null
  translation: string
  sentences: string[]
}

export default function AddCardModal(props: Props) {
  if (!props.isOpen) return null

  return <AddCardModalContent key={props.cardToEdit?.id ?? 'new'} {...props} />
}

function AddCardModalContent({
  onClose,
  folderId,
  userId,
  onCardAdded,
  cardToEdit,
}: Omit<Props, 'isOpen'>) {
  const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual')

  const [word, setWord] = useState(() => cardToEdit?.word ?? '')
  const [transcription, setTranscription] = useState(() => cardToEdit?.transcription ?? '')
  const [translation, setTranslation] = useState(() => cardToEdit?.translation ?? '')
  const [sentencesText, setSentencesText] = useState(() =>
    cardToEdit?.sentences ? cardToEdit.sentences.join('\n') : ''
  )

  const [importText, setImportText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestRequestRef = useRef(0)
  const translationRef = useRef<HTMLInputElement>(null)

  const requestSuggestions = useCallback((value: string) => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)

    const term = value.trim()
    if (term.length < 2) {
      suggestRequestRef.current += 1
      setSuggestions([])
      setSuggestionsOpen(false)
      setSuggesting(false)
      return
    }

    const requestId = ++suggestRequestRef.current

    suggestTimerRef.current = setTimeout(async () => {
      setSuggesting(true)
      try {
        const res = await fetch(`/api/translate?word=${encodeURIComponent(term)}`, {
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => null)) as
          | { translations?: unknown }
          | null

        if (suggestRequestRef.current !== requestId) return

        const list = Array.isArray(data?.translations)
          ? data.translations.filter(
              (item): item is string => typeof item === 'string' && item.trim().length > 0
            )
          : []

        setSuggestions(list)
        setSuggestionsOpen(list.length > 0)
      } catch {
        if (suggestRequestRef.current === requestId) {
          setSuggestions([])
          setSuggestionsOpen(false)
        }
      } finally {
        if (suggestRequestRef.current === requestId) setSuggesting(false)
      }
    }, 500)
  }, [])

  useEffect(() => {
    const initialWord = (cardToEdit?.word ?? '').trim()
    if (initialWord.length < 2) return

    const timer = setTimeout(() => requestSuggestions(initialWord), 0)

    return () => {
      clearTimeout(timer)
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    }
  }, [cardToEdit, requestSuggestions])

  const handleWordChange = (val: string) => {
    setWord(val)
    requestSuggestions(val)
  }

  const applySuggestion = (value: string) => {
    setTranslation(value)
    setSuggestionsOpen(false)
    translationRef.current?.focus()
  }

  const parseImportText = (text: string) => {
    const lines = text.split('\n')
    let validCount = 0
    let skippedCount = 0
    const parsedCards: ParsedCard[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      const parts = rawLine.split('|').map(p => p.trim())
      let w = ''
      let tr: string | null = null
      let tl = ''
      let sentences: string[] = []

      if (parts.length >= 2) {
        w = parts[0]
        const isTranscription =
          parts[1].startsWith('/') ||
          parts[1].startsWith('[') ||
          parts[1].endsWith('/') ||
          parts[1].endsWith(']')

        if (isTranscription && parts.length >= 3) {
          tr = parts[1]
          tl = parts[2]
          sentences = parts.slice(3).filter(Boolean)
        } else {
          tl = parts[1]
          sentences = parts.slice(2).filter(Boolean)
        }
      }

      if (!w || !tl) {
        skippedCount++
      } else {
        validCount++
        parsedCards.push({
          word: w,
          transcription: tr,
          translation: tl,
          sentences,
        })
      }
    }

    return { validCount, skippedCount, parsedCards }
  }

  const { validCount, skippedCount, parsedCards } = parseImportText(importText)

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!word.trim() || !translation.trim()) return

    setLoading(true)
    setError(null)

    const sentencesArray = sentencesText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    if (cardToEdit) {
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          word: word.trim(),
          transcription: transcription.trim() || null,
          translation: translation.trim(),
          sentences: sentencesArray,
        })
        .eq('id', cardToEdit.id)

      setLoading(false)
      if (updateError) {
        setError('Ошибка при обновлении карточки')
      } else {
        onCardAdded()
        onClose()
      }
      return
    }

    const { error: insertError } = await supabase.from('cards').insert([
      {
        user_id: userId,
        folder_id: folderId,
        word: word.trim(),
        transcription: transcription.trim() || null,
        translation: translation.trim(),
        sentences: sentencesArray,
      },
    ])

    setLoading(false)

    if (insertError) {
      setError('Ошибка при добавлении карточки')
      return
    }

    setWord('')
    setTranscription('')
    setTranslation('')
    setSentencesText('')
    setSuggestions([])
    setSuggestionsOpen(false)
    onCardAdded()
    onClose()
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (parsedCards.length === 0) return

    setLoading(true)
    setError(null)

    const rows = parsedCards.map(card => ({
      user_id: userId,
      folder_id: folderId,
      word: card.word,
      transcription: card.transcription,
      translation: card.translation,
      sentences: card.sentences,
    }))

    const { error: importError } = await supabase.from('cards').insert(rows)
    setLoading(false)

    if (importError) {
      setError('Ошибка при импорте карточек')
      return
    }

    setImportText('')
    onCardAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#111110] border border-[#24221e] p-6 shadow-2xl text-[#f2eee5]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">
            {cardToEdit ? 'Редактировать карточку' : 'Добавить карточки'}
          </h3>
          <button
            onClick={onClose}
            className="text-[#948e82] hover:text-[#f2eee5] text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {!cardToEdit && (
          <div className="flex border-b border-[#24221e] mb-4">
            <button
              onClick={() => setActiveTab('manual')}
              className={`pb-2 px-4 text-sm font-medium transition border-b-2 ${
                activeTab === 'manual'
                  ? 'border-[#c9a96e] text-[#c9a96e]'
                  : 'border-transparent text-[#948e82] hover:text-[#f2eee5]'
              }`}
            >
              Вручную
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`pb-2 px-4 text-sm font-medium transition border-b-2 ${
                activeTab === 'import'
                  ? 'border-[#c9a96e] text-[#c9a96e]'
                  : 'border-transparent text-[#948e82] hover:text-[#f2eee5]'
              }`}
            >
              Текстовый импорт
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-[#bb7464]/20 border border-[#bb7464] p-3 text-sm">
            {error}
          </div>
        )}

        {activeTab === 'manual' || cardToEdit ? (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#948e82] mb-1">
                Слово (англ) *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={word}
                  onChange={e => handleWordChange(e.target.value)}
                  onFocus={() => {
                    if (suggestions.length > 0) setSuggestionsOpen(true)
                  }}
                  onBlur={() => {
                    setTimeout(() => setSuggestionsOpen(false), 120)
                  }}
                  className="w-full rounded-lg border border-[#2d2a25] bg-[#090909] px-3 py-2 pr-20 text-[#f2eee5] focus:border-[#c9a96e] focus:outline-none"
                  placeholder="apple"
                />
                {suggesting && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.14em] text-[#6f6a61]">
                    ищу...
                  </span>
                )}

                {suggestionsOpen && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[#2d2a25] bg-[#111110] shadow-2xl">
                    <p className="border-b border-[#24221e] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[#948e82]">
                      Возможные переводы
                    </p>
                    <div className="max-h-52 overflow-y-auto p-1">
                      {suggestions.map(item => (
                        <button
                          key={item}
                          type="button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => applySuggestion(item)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-[#f2eee5] transition hover:bg-[#c9a96e]/10 hover:text-[#c9a96e]"
                        >
                          <span>{item}</span>
                          <span className="text-xs text-[#6f6a61]">→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-[#6f6a61]">
                {suggesting
                  ? 'Подбираю перевод...'
                  : suggestions.length > 0
                  ? 'Выберите вариант из списка или введите свой перевод.'
                  : 'Начните вводить слово — появятся варианты перевода.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#948e82] mb-1">
                Транскрипция
              </label>
              <input
                type="text"
                value={transcription}
                onChange={e => setTranscription(e.target.value)}
                className="w-full rounded-lg border border-[#2d2a25] bg-[#090909] px-3 py-2 text-[#f2eee5] focus:border-[#c9a96e] focus:outline-none"
                placeholder="[ˈæp.əl]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#948e82] mb-1">
                Перевод *
              </label>
              <input
                ref={translationRef}
                type="text"
                required
                value={translation}
                onChange={e => setTranslation(e.target.value)}
                className="w-full rounded-lg border border-[#2d2a25] bg-[#090909] px-3 py-2 text-[#f2eee5] focus:border-[#c9a96e] focus:outline-none"
                placeholder="яблоко"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#948e82] mb-1">
                Примеры (каждый с новой строки)
              </label>
              <textarea
                rows={3}
                value={sentencesText}
                onChange={e => setSentencesText(e.target.value)}
                className="w-full rounded-lg border border-[#2d2a25] bg-[#090909] px-3 py-2 text-[#f2eee5] focus:border-[#c9a96e] focus:outline-none resize-none"
                placeholder="I like to eat a red apple."
              />
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-[#c9a96e] py-2.5 text-[#0b0b0a] font-medium hover:bg-[#b8975b] transition disabled:opacity-50"
              >
                {loading
                  ? 'Сохранение...'
                  : cardToEdit
                  ? 'Сохранить изменения'
                  : 'Добавить карточку'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 rounded-lg border border-[#2d2a25] bg-transparent text-[#948e82] hover:text-[#f2eee5] hover:border-[#4a463e] transition"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#948e82] mb-1">
                Импорт через разделитель «|» (слово | транскрипция | перевод | пример 1 | пример 2)
              </label>
              <textarea
                rows={7}
                required
                value={importText}
                onChange={e => setImportText(e.target.value)}
                className="w-full rounded-lg border border-[#2d2a25] bg-[#090909] px-3 py-2 text-[#f2eee5] font-mono text-sm focus:border-[#c9a96e] focus:outline-none resize-none"
                placeholder={`apple | /ˈæp.əl/ | яблоко | I eat an apple every day. | She bought two apples.\nbook | /bʊk/ | книга | This book is interesting. |`}
              />
            </div>

            {importText.trim() && (
              <div className="rounded-lg bg-[#090909] p-3 text-xs space-y-1 border border-[#24221e]">
                <p className="text-[#f2eee5]">Будет создано карточек: {validCount}</p>
                {skippedCount > 0 && (
                  <p className="text-[#bb7464]">Пропущено строк: {skippedCount}</p>
                )}
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={loading || validCount === 0}
                className="flex-1 rounded-lg bg-[#c9a96e] py-2.5 text-[#0b0b0a] font-medium hover:bg-[#b8975b] transition disabled:opacity-50"
              >
                {loading ? 'Импорт...' : 'Импортировать слова'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 rounded-lg border border-[#2d2a25] bg-transparent text-[#948e82] hover:text-[#f2eee5] hover:border-[#4a463e] transition"
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
