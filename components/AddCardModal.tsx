'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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

type ExistingCard = {
  id: string
  word: string
  transcription: string | null
  translation: string
  sentences: string[] | null
}

type ConflictChoice = 'new' | 'old' | 'both'

type PendingCard = {
  parsed: ParsedCard
  existing: ExistingCard | null
  choice: ConflictChoice
}

function normalizeWord(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function ChoiceOption({
  name,
  checked,
  title,
  detail,
  onSelect,
}: {
  name: string
  checked: boolean
  title: string
  detail: ReactNode
  onSelect: () => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${
        checked
          ? 'border-[#c9a96e]/70 bg-[#c9a96e]/10'
          : 'border-[#24221e] bg-[#111110] hover:border-[#4a463e]'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-[#c9a96e]' : 'border-[#4a463e]'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#c9a96e]" />}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[10px] uppercase tracking-[0.14em] ${
            checked ? 'text-[#c9a96e]' : 'text-[#948e82]'
          }`}
        >
          {title}
        </span>
        <span className="mt-0.5 block break-words text-sm text-[#f2eee5]">{detail}</span>
      </span>
    </label>
  )
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
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [pendingCards, setPendingCards] = useState<PendingCard[]>([])
  const [showConflictScreen, setShowConflictScreen] = useState(false)
  const [conflictIntent, setConflictIntent] = useState<'manual' | 'import'>('manual')

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
    let skippedCount = 0
    let duplicateCount = 0
    const parsedCards: ParsedCard[] = []
    const indexByWord = new Map<string, number>()

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
        continue
      }

      const card: ParsedCard = {
        word: w,
        transcription: tr,
        translation: tl,
        sentences,
      }
      const key = normalizeWord(w)
      const existingIndex = indexByWord.get(key)

      if (existingIndex !== undefined) {
        parsedCards[existingIndex] = card
        duplicateCount++
      } else {
        indexByWord.set(key, parsedCards.length)
        parsedCards.push(card)
      }
    }

    return { validCount: parsedCards.length, skippedCount, duplicateCount, parsedCards }
  }

  const { validCount, skippedCount, duplicateCount, parsedCards } = parseImportText(importText)

  const fetchFolderCards = async (): Promise<ExistingCard[] | null> => {
    const { data, error: fetchError } = await supabase
      .from('cards')
      .select('id, word, transcription, translation, sentences')
      .eq('folder_id', folderId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError('Не удалось проверить повторы в папке')
      return null
    }

    return (data ?? []) as ExistingCard[]
  }

  const buildPendingCards = (
    cards: ParsedCard[],
    existingCards: ExistingCard[],
    defaultChoice: ConflictChoice = 'new'
  ): PendingCard[] => {
    const existingByWord = new Map<string, ExistingCard>()
    for (const card of existingCards) {
      const key = normalizeWord(card.word)
      if (!existingByWord.has(key)) existingByWord.set(key, card)
    }

    return cards.map(parsed => ({
      parsed,
      existing: existingByWord.get(normalizeWord(parsed.word)) ?? null,
      choice: defaultChoice,
    }))
  }

  const saveCards = async (
    items: PendingCard[],
    intent: 'manual' | 'import',
    editId?: string
  ) => {
    setLoading(true)
    setError(null)

    const toPayload = (card: ParsedCard) => ({
      word: card.word,
      transcription: card.transcription,
      translation: card.translation,
      sentences: card.sentences ?? [],
    })

    const inserts: Array<{
      user_id: string
      folder_id: string
      word: string
      transcription: string | null
      translation: string
      sentences: string[]
    }> = []
    const updates: Array<{ id: string; card: ParsedCard }> = []
    const deletes: string[] = []

    if (editId) {
      const item = items[0]
      if (!item) {
        setLoading(false)
        return
      }

      if (item.existing && item.choice === 'old') {
        setLoading(false)
        setPendingCards([])
        setShowConflictScreen(false)
        onClose()
        return
      }

      updates.push({ id: editId, card: item.parsed })
      if (item.existing && item.choice === 'new') deletes.push(item.existing.id)
    } else {
      for (const item of items) {
        if (!item.existing) {
          inserts.push({ user_id: userId, folder_id: folderId, ...toPayload(item.parsed) })
        } else if (item.choice === 'new') {
          updates.push({ id: item.existing.id, card: item.parsed })
        } else if (item.choice === 'both') {
          inserts.push({ user_id: userId, folder_id: folderId, ...toPayload(item.parsed) })
        }
      }
    }

    let saveError: string | null = null

    if (updates.length > 0) {
      const results = await Promise.all(
        updates.map(update =>
          supabase.from('cards').update(toPayload(update.card)).eq('id', update.id)
        )
      )

      if (results.some(result => result.error)) {
        saveError = 'Ошибка при обновлении карточки'
      }
    }

    if (!saveError && inserts.length > 0) {
      const { error: insertError } = await supabase.from('cards').insert(inserts)

      if (insertError) {
        saveError =
          intent === 'manual'
            ? 'Ошибка при добавлении карточки'
            : 'Ошибка при импорте карточек'
      }
    }

    if (!saveError && deletes.length > 0) {
      const { error: deleteError } = await supabase.from('cards').delete().in('id', deletes)

      if (deleteError) {
        saveError = 'Ошибка при удалении старой карточки'
      }
    }

    setLoading(false)

    if (saveError) {
      setError(saveError)
      return
    }

    setWord('')
    setTranscription('')
    setTranslation('')
    setSentencesText('')
    setSuggestions([])
    setSuggestionsOpen(false)
    setImportText('')
    setPendingCards([])
    setShowConflictScreen(false)
    onCardAdded()
    onClose()
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!word.trim() || !translation.trim()) return

    setError(null)

    const sentencesArray = sentencesText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    const parsed: ParsedCard = {
      word: word.trim(),
      transcription: transcription.trim() || null,
      translation: translation.trim(),
      sentences: sentencesArray,
    }

    setCheckingDuplicates(true)
    const existingCards = await fetchFolderCards()
    setCheckingDuplicates(false)

    if (!existingCards) return

    if (cardToEdit) {
      const items = buildPendingCards(
        [parsed],
        existingCards.filter(card => card.id !== cardToEdit.id),
        'both'
      )

      setPendingCards(items)
      setConflictIntent('manual')

      if (items.some(item => item.existing)) {
        setShowConflictScreen(true)
        return
      }

      await saveCards(items, 'manual', cardToEdit.id)
      return
    }

    const items = buildPendingCards([parsed], existingCards)

    setPendingCards(items)
    setConflictIntent('manual')

    if (items.some(item => item.existing)) {
      setShowConflictScreen(true)
      return
    }

    await saveCards(items, 'manual')
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (parsedCards.length === 0) return

    setError(null)
    setCheckingDuplicates(true)
    const existingCards = await fetchFolderCards()
    setCheckingDuplicates(false)

    if (!existingCards) return

    const items = buildPendingCards(parsedCards, existingCards)
    setPendingCards(items)
    setConflictIntent('import')

    if (items.some(item => item.existing)) {
      setShowConflictScreen(true)
      return
    }

    await saveCards(items, 'import')
  }

  const conflictCards = pendingCards.filter(item => item.existing)
  const allNew =
    conflictCards.length > 0 && conflictCards.every(item => item.choice === 'new')
  const allOld =
    conflictCards.length > 0 && conflictCards.every(item => item.choice === 'old')
  const allBoth =
    conflictCards.length > 0 && conflictCards.every(item => item.choice === 'both')

  const addCount = pendingCards.filter(
    item => !item.existing || item.choice === 'both'
  ).length
  const updateCount = pendingCards.filter(
    item => item.existing && item.choice === 'new'
  ).length
  const skipCount = pendingCards.filter(
    item => item.existing && item.choice === 'old'
  ).length

  const setAllConflictChoices = (choice: ConflictChoice) => {
    setPendingCards(prev =>
      prev.map(item => (item.existing ? { ...item, choice } : item))
    )
  }

  const setConflictChoice = (index: number, choice: ConflictChoice) => {
    setPendingCards(prev =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? { ...item, choice } : item
      )
    )
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

        {!cardToEdit && !showConflictScreen && (
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

        {showConflictScreen ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 border-b border-[#24221e] pb-3">
              <div>
                <h4 className="text-sm font-semibold text-[#f2eee5]">
                  {cardToEdit ? 'Слово уже есть в папке' : `Найдены совпадения: ${conflictCards.length}`}
                </h4>
                <p className="mt-1 text-xs text-[#948e82]">
                  {cardToEdit
                    ? 'Выберите, что сохранить: изменённую карточку, старую или обе.'
                    : 'Для каждого слова выберите: оставить новую карточку, старую или обе.'}
                </p>
                {!cardToEdit && pendingCards.length > conflictCards.length && (
                  <p className="mt-1 text-xs text-[#6f6a61]">
                    Остальные слова ({pendingCards.length - conflictCards.length}) добавятся
                    без вопросов.
                  </p>
                )}
              </div>

              {conflictCards.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('new')}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      allNew
                        ? 'border-[#c9a96e] bg-[#c9a96e]/20 text-[#c9a96e]'
                        : 'border-[#24221e] bg-[#111110] text-[#948e82] hover:border-[#4a463e] hover:text-[#f2eee5]'
                    }`}
                  >
                    Для всех: новая
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('old')}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      allOld
                        ? 'border-[#c9a96e] bg-[#c9a96e]/20 text-[#c9a96e]'
                        : 'border-[#24221e] bg-[#111110] text-[#948e82] hover:border-[#4a463e] hover:text-[#f2eee5]'
                    }`}
                  >
                    Для всех: старая
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('both')}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      allBoth
                        ? 'border-[#c9a96e] bg-[#c9a96e]/20 text-[#c9a96e]'
                        : 'border-[#24221e] bg-[#111110] text-[#948e82] hover:border-[#4a463e] hover:text-[#f2eee5]'
                    }`}
                  >
                    Для всех: обе
                  </button>
                </div>
              )}
            </div>

            <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
              {pendingCards.map((item, index) => {
                if (!item.existing) return null

                return (
                  <div
                    key={`${normalizeWord(item.parsed.word)}-${index}`}
                    className="space-y-2.5 rounded-xl border border-[#24221e] bg-[#090909] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-bold text-[#f2eee5]">
                          {item.parsed.word}
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-[#c9a96e]">
                          {cardToEdit ? 'Совпадает с другой карточкой' : 'Уже есть в этой папке'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[#c9a96e]/40 bg-[#c9a96e]/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#c9a96e]">
                        {item.choice === 'new' ? 'новая' : item.choice === 'old' ? 'старая' : 'обе'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <ChoiceOption
                        name={`conflict-${index}`}
                        checked={item.choice === 'new'}
                        title="Оставить новую"
                        detail={
                          <>
                            {item.parsed.translation}
                            {item.parsed.transcription && (
                              <span className="ml-2 text-xs text-[#948e82]">
                                ({item.parsed.transcription})
                              </span>
                            )}
                          </>
                        }
                        onSelect={() => setConflictChoice(index, 'new')}
                      />
                      <ChoiceOption
                        name={`conflict-${index}`}
                        checked={item.choice === 'old'}
                        title="Оставить старую"
                        detail={
                          <>
                            {item.existing.translation}
                            {item.existing.transcription && (
                              <span className="ml-2 text-xs text-[#948e82]">
                                ({item.existing.transcription})
                              </span>
                            )}
                          </>
                        }
                        onSelect={() => setConflictChoice(index, 'old')}
                      />
                      <ChoiceOption
                        name={`conflict-${index}`}
                        checked={item.choice === 'both'}
                        title="Оставить обе"
                        detail={
                          <>
                            {item.parsed.translation}
                            <span className="mx-1.5 text-[#6f6a61]">и</span>
                            {item.existing.translation}
                          </>
                        }
                        onSelect={() => setConflictChoice(index, 'both')}
                      />
                    </div>

                    <p className="rounded-lg bg-[#111110] px-3 py-2 text-[11px] leading-4 text-[#6f6a61]">
                      {cardToEdit
                        ? item.choice === 'old'
                          ? 'Изменения не сохранятся, карточка останется как была.'
                          : item.choice === 'new'
                          ? 'Изменения сохранятся, вторая карточка с этим словом удалится.'
                          : 'Изменения сохранятся, обе карточки останутся в папке.'
                        : item.choice === 'old'
                        ? 'Новая карточка не добавится, останется только существующая.'
                        : item.choice === 'new'
                        ? 'Существующая карточка обновится новыми данными.'
                        : 'В папке будет две карточки с этим словом.'}
                    </p>
                  </div>
                )
              })}
            </div>

            <div className="space-y-3 border-t border-[#24221e] pt-3">
              <p className="text-xs text-[#948e82]">
                {cardToEdit
                  ? pendingCards[0]?.choice === 'old'
                    ? 'Изменения не будут сохранены.'
                    : pendingCards[0]?.choice === 'new'
                    ? 'Изменения сохранятся, дубликат удалится.'
                    : 'Изменения сохранятся, обе карточки останутся.'
                  : `Добавим: ${addCount} · Обновим: ${updateCount} · Пропустим: ${skipCount}`}
              </p>

              <div className="flex space-x-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void saveCards(pendingCards, conflictIntent, cardToEdit?.id)
                  }
                  className="flex-1 rounded-lg bg-[#c9a96e] py-2.5 font-medium text-[#0b0b0a] transition hover:bg-[#b8975b] disabled:opacity-50"
                >
                  {loading
                    ? 'Сохраняю...'
                    : cardToEdit
                    ? 'Применить выбор'
                    : 'Добавить выбранное'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingCards([])
                    setShowConflictScreen(false)
                  }}
                  className="rounded-lg border border-[#2d2a25] bg-transparent px-4 text-[#948e82] transition hover:border-[#4a463e] hover:text-[#f2eee5]"
                >
                  Назад
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'manual' || cardToEdit ? (
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
                disabled={loading || checkingDuplicates}
                className="flex-1 rounded-lg bg-[#c9a96e] py-2.5 text-[#0b0b0a] font-medium hover:bg-[#b8975b] transition disabled:opacity-50"
              >
                {checkingDuplicates
                  ? 'Проверяю повторы...'
                  : loading
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
                <p className="text-[#f2eee5]">Уникальных слов: {validCount}</p>
                {duplicateCount > 0 && (
                  <p className="text-[#c9a96e]">
                    Повторов в тексте: {duplicateCount} — оставлен последний вариант
                  </p>
                )}
                {skippedCount > 0 && (
                  <p className="text-[#bb7464]">Пропущено строк: {skippedCount}</p>
                )}
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={loading || checkingDuplicates || validCount === 0}
                className="flex-1 rounded-lg bg-[#c9a96e] py-2.5 text-[#0b0b0a] font-medium hover:bg-[#b8975b] transition disabled:opacity-50"
              >
                {checkingDuplicates
                  ? 'Проверяю повторы...'
                  : loading
                  ? 'Импорт...'
                  : 'Импортировать слова'}
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
