'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Card } from '@/types/database'
import Icon from '@/components/ui/Icon'
import {
  createCards,
  deleteCard,
  fetchCards,
  updateCardContent,
} from '@/lib/offline/repo'

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

type ExistingCard = Card

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
          ? 'border-[#8ea2ff]/70 bg-[#8ea2ff]/10'
          : 'border-[#24242b] bg-[#15151a] hover:border-[#44444e]'
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
          checked ? 'border-[#8ea2ff]' : 'border-[#44444e]'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#8ea2ff]" />}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-xs ${
            checked ? 'text-[#8ea2ff]' : 'text-[#8a8a96]'
          }`}
        >
          {title}
        </span>
        <span className="mt-0.5 block break-words text-sm text-[#ececf1]">{detail}</span>
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
          signal: AbortSignal.timeout(5000),
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
    try {
      return await fetchCards({ userId, folderId, order: 'created_desc' })
    } catch {
      setError('Не удалось проверить повторы в папке')
      return null
    }
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

    const inserts: ParsedCard[] = []
    const updates: Array<{ id: string; card: ParsedCard; base: string | null }> = []
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

      updates.push({
        id: editId,
        card: item.parsed,
        base: cardToEdit?.content_updated_at ?? null,
      })
      if (item.existing && item.choice === 'new') deletes.push(item.existing.id)
    } else {
      for (const item of items) {
        if (!item.existing) {
          inserts.push(item.parsed)
        } else if (item.choice === 'new') {
          updates.push({
            id: item.existing.id,
            card: item.parsed,
            base: item.existing.content_updated_at ?? null,
          })
        } else if (item.choice === 'both') {
          inserts.push(item.parsed)
        }
      }
    }

    let saveError: string | null = null

    try {
      for (const update of updates) {
        const result = await updateCardContent(
          update.id,
          userId,
          toPayload(update.card),
          update.base
        )
        if (!result.ok) {
          saveError = result.error ?? 'Ошибка при обновлении карточки'
          break
        }
      }

      if (!saveError && inserts.length > 0) {
        await createCards(userId, folderId, inserts)
      }

      if (!saveError && deletes.length > 0) {
        for (const id of deletes) await deleteCard(id)
      }
    } catch {
      saveError =
        intent === 'manual'
          ? 'Ошибка при добавлении карточки'
          : 'Ошибка при импорте карточек'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-[#24242b] bg-[#15151a] p-5 text-[#ececf1] shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-bold">
              {cardToEdit ? 'Изменить слово' : 'Добавить слова'}
            </h3>
            {!cardToEdit && !showConflictScreen && (
              <p className="mt-1 text-sm text-[#8a8a96]">
                {activeTab === 'manual'
                  ? 'Введите слово — перевод подскажем сами.'
                  : 'Вставьте сразу много слов, по одному на строку.'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn shrink-0"
            aria-label="Закрыть"
          >
            <Icon name="plus" size={20} className="rotate-45" />
          </button>
        </div>

        {!cardToEdit && !showConflictScreen && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[#0d0d10] p-1">
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                activeTab === 'manual'
                  ? 'bg-[#24242b] text-[#ececf1]'
                  : 'text-[#8a8a96] hover:text-[#ececf1]'
              }`}
            >
              По одному
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                activeTab === 'import'
                  ? 'bg-[#24242b] text-[#ececf1]'
                  : 'text-[#8a8a96] hover:text-[#ececf1]'
              }`}
            >
              Списком
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-[#e5786f]/40 bg-[#e5786f]/10 px-4 py-3 text-sm text-[#f0a39b]">
            {error}
          </div>
        )}

        {showConflictScreen ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 border-b border-[#24242b] pb-3">
              <div>
                <h4 className="text-sm font-semibold text-[#ececf1]">
                  {cardToEdit ? 'Слово уже есть в папке' : `Найдены совпадения: ${conflictCards.length}`}
                </h4>
                <p className="mt-1 text-xs text-[#8a8a96]">
                  {cardToEdit
                    ? 'Выберите, что сохранить: изменённую карточку, старую или обе.'
                    : 'Для каждого слова выберите: оставить новую карточку, старую или обе.'}
                </p>
                {!cardToEdit && pendingCards.length > conflictCards.length && (
                  <p className="mt-1 text-xs text-[#6b6b76]">
                    Остальные слова ({pendingCards.length - conflictCards.length}) добавятся
                    без вопросов.
                  </p>
                )}
              </div>

              {conflictCards.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-[#8a8a96]">Для всех:</span>
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('new')}
                    className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-[13px] font-medium transition ${
                      allNew
                        ? 'border-[#8ea2ff] bg-[#8ea2ff]/20 text-[#8ea2ff]'
                        : 'border-[#24242b] bg-[#15151a] text-[#8a8a96] hover:border-[#44444e] hover:text-[#ececf1]'
                    }`}
                  >
                    новые
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('old')}
                    className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-[13px] font-medium transition ${
                      allOld
                        ? 'border-[#8ea2ff] bg-[#8ea2ff]/20 text-[#8ea2ff]'
                        : 'border-[#24242b] bg-[#15151a] text-[#8a8a96] hover:border-[#44444e] hover:text-[#ececf1]'
                    }`}
                  >
                    старые
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllConflictChoices('both')}
                    className={`flex-1 whitespace-nowrap rounded-lg border px-3 py-2 text-[13px] font-medium transition ${
                      allBoth
                        ? 'border-[#8ea2ff] bg-[#8ea2ff]/20 text-[#8ea2ff]'
                        : 'border-[#24242b] bg-[#15151a] text-[#8a8a96] hover:border-[#44444e] hover:text-[#ececf1]'
                    }`}
                  >
                    обе
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
                    className="space-y-2.5 rounded-xl border border-[#24242b] bg-[#0d0d10] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-bold text-[#ececf1]">
                          {item.parsed.word}
                        </div>
                        <p className="text-xs text-[#8ea2ff]">
                          {cardToEdit ? 'Совпадает с другой карточкой' : 'Уже есть в этой папке'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-[#8ea2ff]/40 bg-[#8ea2ff]/10 px-2.5 py-0.5 text-xs text-[#8ea2ff]">
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
                              <span className="ml-2 text-xs text-[#8a8a96]">
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
                              <span className="ml-2 text-xs text-[#8a8a96]">
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
                            <span className="mx-1.5 text-[#6b6b76]">и</span>
                            {item.existing.translation}
                          </>
                        }
                        onSelect={() => setConflictChoice(index, 'both')}
                      />
                    </div>

                    <p className="rounded-lg bg-[#15151a] px-3 py-2 text-xs leading-4 text-[#6b6b76]">
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

            <div className="space-y-3 border-t border-[#24242b] pt-3">
              <p className="text-xs text-[#8a8a96]">
                {cardToEdit
                  ? pendingCards[0]?.choice === 'old'
                    ? 'Изменения не будут сохранены.'
                    : pendingCards[0]?.choice === 'new'
                    ? 'Изменения сохранятся, дубликат удалится.'
                    : 'Изменения сохранятся, обе карточки останутся.'
                  : `Добавим: ${addCount} · Обновим: ${updateCount} · Пропустим: ${skipCount}`}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void saveCards(pendingCards, conflictIntent, cardToEdit?.id)
                  }
                  className="btn btn-primary flex-1"
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
                  className="btn btn-secondary"
                >
                  Назад
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'manual' || cardToEdit ? (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                Слово на английском
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
                  className="field"
                  style={{ paddingRight: '5rem' }}
                  placeholder="apple"
                />
                {suggesting && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6b6b76]">
                    ищу...
                  </span>
                )}

                {suggestionsOpen && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[#2c2c34] bg-[#15151a] shadow-2xl">
                    <p className="border-b border-[#24242b] px-3 py-2 text-xs text-[#8a8a96]">
                      Возможные переводы
                    </p>
                    <div className="max-h-52 overflow-y-auto p-1">
                      {suggestions.map(item => (
                        <button
                          key={item}
                          type="button"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => applySuggestion(item)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-[#ececf1] transition hover:bg-[#8ea2ff]/10 hover:text-[#8ea2ff]"
                        >
                          <span>{item}</span>
                          <span className="text-xs text-[#6b6b76]">→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-4 text-[#6b6b76]">
                {suggesting
                  ? 'Подбираю перевод...'
                  : suggestions.length > 0
                  ? 'Выберите вариант из списка или введите свой перевод.'
                  : 'Начните вводить слово — появятся варианты перевода.'}
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                Транскрипция <span className="font-normal text-[#6b6b76]">— необязательно</span>
              </label>
              <input
                type="text"
                value={transcription}
                onChange={e => setTranscription(e.target.value)}
                className="field font-mono"
                placeholder="[ˈæp.əl]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                Перевод
              </label>
              <input
                ref={translationRef}
                type="text"
                required
                value={translation}
                onChange={e => setTranslation(e.target.value)}
                className="field"
                placeholder="яблоко"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#b0b0bb]">
                Примеры <span className="font-normal text-[#6b6b76]">— каждый с новой строки</span>
              </label>
              <textarea
                rows={3}
                value={sentencesText}
                onChange={e => setSentencesText(e.target.value)}
                className="field resize-none"
                placeholder="I like to eat a red apple."
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading || checkingDuplicates}
                className="btn btn-primary flex-1"
              >
                {checkingDuplicates
                  ? 'Проверяю повторы...'
                  : loading
                  ? 'Сохранение...'
                  : cardToEdit
                  ? 'Сохранить изменения'
                  : 'Добавить слово'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <div className="hint mb-3">
                <Icon name="info" size={18} />
                <p>
                  Одна строка — одно слово. Части разделяйте знаком «|»:
                  <br />
                  <span className="text-[#ececf1]">слово | транскрипция | перевод | примеры</span>
                  <br />
                  Транскрипцию и примеры можно не писать.
                </p>
              </div>
              <textarea
                rows={7}
                required
                value={importText}
                onChange={e => setImportText(e.target.value)}
                aria-label="Список слов для импорта"
                className="field resize-none font-mono"
                style={{ fontSize: '0.875rem' }}
                placeholder={`apple | /ˈæp.əl/ | яблоко | I eat an apple every day. | She bought two apples.\nbook | /bʊk/ | книга | This book is interesting. |`}
              />
            </div>

            {importText.trim() && (
              <div className="space-y-1 rounded-xl border border-[#24242b] bg-[#0d0d10] px-4 py-3 text-sm">
                <p className="text-[#ececf1]">Уникальных слов: {validCount}</p>
                {duplicateCount > 0 && (
                  <p className="text-[#8ea2ff]">
                    Повторов в тексте: {duplicateCount} — оставлен последний вариант
                  </p>
                )}
                {skippedCount > 0 && (
                  <p className="text-[#e5786f]">Пропущено строк: {skippedCount}</p>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={loading || checkingDuplicates || validCount === 0}
                className="btn btn-primary flex-1"
              >
                {checkingDuplicates
                  ? 'Проверяю повторы...'
                  : loading
                  ? 'Импорт...'
                  : 'Добавить все слова'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
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
