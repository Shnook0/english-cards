'use client'

import { useState, useEffect, useRef } from 'react'
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

type ExistingMatch = {
  id: string
  word: string
  transcription: string | null
  translation: string
  sentences: string[] | null
  sync_group_id: string | null
  folders?: { name: string }[] | { name: string } | null
}

type ExistingDuplicateInfo = {
  id: string
  word: string
  transcription: string | null
  translation: string
  sentences: string[] | null
  sync_group_id: string | null
  folderName: string
}

type DuplicateItem = {
  parsed: {
    word: string
    transcription: string | null
    translation: string
    sentences: string[]
  }
  existing: ExistingDuplicateInfo | null
  choice: 'new' | 'old'
}

function getFolderName(folders: any): string {
  if (!folders) return 'другой папке'
  if (Array.isArray(folders)) return folders[0]?.name || 'другой папке'
  return folders.name || 'другой папке'
}

export default function AddCardModal({
  isOpen,
  onClose,
  folderId,
  userId,
  onCardAdded,
  cardToEdit,
}: Props) {
  const [activeTab, setActiveTab] = useState<'manual' | 'import'>('manual')

  const [word, setWord] = useState('')
  const [transcription, setTranscription] = useState('')
  const [translation, setTranslation] = useState('')
  const [sentencesText, setSentencesText] = useState('')

  const [importText, setImportText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [existingMatches, setExistingMatches] = useState<ExistingMatch[]>([])
  const [linkToGroup, setLinkToGroup] = useState<string | null>(null)
  const [matchNotice, setMatchNotice] = useState<string | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([])
  const [showConflictScreen, setShowConflictScreen] = useState(false)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)

  useEffect(() => {
    if (cardToEdit) {
      setWord(cardToEdit.word || '')
      setTranscription(cardToEdit.transcription || '')
      setTranslation(cardToEdit.translation || '')
      setSentencesText(cardToEdit.sentences ? cardToEdit.sentences.join('\n') : '')
      setLinkToGroup(cardToEdit.sync_group_id || null)
      setActiveTab('manual')
    } else {
      setWord('')
      setTranscription('')
      setTranslation('')
      setSentencesText('')
      setLinkToGroup(null)
    }
    setExistingMatches([])
    setMatchNotice(null)
    setError(null)
    setDuplicates([])
    setShowConflictScreen(false)
  }, [cardToEdit, isOpen])

  if (!isOpen) return null

  const handleWordChange = (val: string) => {
    setWord(val)
    if (cardToEdit) return

    setLinkToGroup(null)
    setMatchNotice(null)
    setExistingMatches([])

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

    if (!val || val.trim().length < 2) return

    debounceTimerRef.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('cards')
        .select('id, word, transcription, translation, sentences, sync_group_id, folders(name)')
        .ilike('word', val.trim())
        .limit(5)

      if (!error && data && data.length > 0) {
        setExistingMatches(data as unknown as ExistingMatch[])
        const first = data[0] as any
        const folderName = getFolderName(first.folders)
        setMatchNotice(
          `Это слово уже есть в папке "${folderName}" (перевод: ${first.translation}).`
        )
      }
    }, 500)
  }

  const handleUseExistingData = (match: ExistingMatch) => {
    setTranscription(match.transcription || '')
    setTranslation(match.translation || '')
    setSentencesText(match.sentences ? match.sentences.join('\n') : '')
    if (match.sync_group_id) setLinkToGroup(match.sync_group_id)
    setMatchNotice('Данные заполнены из существующей карточки.')
  }

  const handleLinkToAll = async () => {
    const first = existingMatches[0]
    if (!first) return

    let groupId = first.sync_group_id
    if (!groupId) {
      groupId = crypto.randomUUID()
      const ids = existingMatches.map(m => m.id)
      await supabase.from('cards').update({ sync_group_id: groupId }).in('id', ids)
    }
    setLinkToGroup(groupId)
    setMatchNotice('Карточка будет связана со всеми копиями.')
  }

  const parseImportText = (text: string) => {
    const lines = text.split('\n')
    let validCount = 0
    let skippedCount = 0
    const parsedCards: {
      word: string
      transcription: string | null
      translation: string
      sentences: string[]
    }[] = []

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
      const updateFields = {
        word: word.trim(),
        transcription: transcription.trim() || null,
        translation: translation.trim(),
        sentences: sentencesArray,
      }

      let updateError = null
      if (cardToEdit.sync_group_id) {
        const res = await supabase
          .from('cards')
          .update(updateFields)
          .eq('sync_group_id', cardToEdit.sync_group_id)
        updateError = res.error
      } else {
        const res = await supabase
          .from('cards')
          .update(updateFields)
          .eq('id', cardToEdit.id)
        updateError = res.error
      }

      setLoading(false)
      if (updateError) {
        setError('Ошибка при обновлении карточки')
      } else {
        onCardAdded()
        onClose()
      }
    } else {
      const insertData: Record<string, unknown> = {
        user_id: userId,
        folder_id: folderId,
        word: word.trim(),
        transcription: transcription.trim() || null,
        translation: translation.trim(),
        sentences: sentencesArray,
      }
      if (linkToGroup) insertData.sync_group_id = linkToGroup

      const { error: insertError } = await supabase.from('cards').insert([insertData])
      setLoading(false)

      if (insertError) {
        setError('Ошибка при добавлении карточки')
      } else {
        setWord('')
        setTranscription('')
        setTranslation('')
        setSentencesText('')
        setLinkToGroup(null)
        setMatchNotice(null)
        setExistingMatches([])
        onCardAdded()
        onClose()
      }
    }
  }

  const handleStartImportCheck = async (e: React.FormEvent) => {
    e.preventDefault()
    if (parsedCards.length === 0) return

    setCheckingDuplicates(true)
    setError(null)

    const duplicateItems: DuplicateItem[] = []

    for (const card of parsedCards) {
      const { data, error } = await supabase
        .from('cards')
        .select('id, word, transcription, translation, sentences, sync_group_id, folders(name)')
        .ilike('word', card.word)
        .limit(1)

      let existingInfo: ExistingDuplicateInfo | null = null

      if (!error && data && data.length > 0) {
        const match = data[0] as any
        existingInfo = {
          id: match.id,
          word: match.word,
          transcription: match.transcription,
          translation: match.translation,
          sentences: match.sentences,
          sync_group_id: match.sync_group_id,
          folderName: getFolderName(match.folders),
        }
      }

      duplicateItems.push({
        parsed: card,
        existing: existingInfo,
        choice: 'new',
      })
    }

    setCheckingDuplicates(false)
    setDuplicates(duplicateItems)

    const hasConflicts = duplicateItems.some(item => item.existing !== null)

    if (hasConflicts) {
      setShowConflictScreen(true)
    } else {
      executeFinalImport(duplicateItems)
    }
  }

  const executeFinalImport = async (itemsToImport: DuplicateItem[]) => {
    setLoading(true)
    setError(null)

    const finalInsertCards: Record<string, unknown>[] = []

    for (const item of itemsToImport) {
      if (!item.existing) {
        finalInsertCards.push({
          user_id: userId,
          folder_id: folderId,
          word: item.parsed.word,
          transcription: item.parsed.transcription,
          translation: item.parsed.translation,
          sentences: item.parsed.sentences,
        })
      } else if (item.choice === 'new') {
        finalInsertCards.push({
          user_id: userId,
          folder_id: folderId,
          word: item.parsed.word,
          transcription: item.parsed.transcription,
          translation: item.parsed.translation,
          sentences: item.parsed.sentences,
        })
      } else {
        let groupId = item.existing.sync_group_id

        if (!groupId) {
          groupId = crypto.randomUUID()
          await supabase
            .from('cards')
            .update({ sync_group_id: groupId })
            .eq('id', item.existing.id)
        }

        finalInsertCards.push({
          user_id: userId,
          folder_id: folderId,
          word: item.existing.word,
          transcription: item.existing.transcription,
          translation: item.existing.translation,
          sentences: item.existing.sentences || [],
          sync_group_id: groupId,
        })
      }
    }

    const { error: importError } = await supabase.from('cards').insert(finalInsertCards)
    setLoading(false)

    if (importError) {
      setError('Ошибка при импорте карточек')
    } else {
      setImportText('')
      setShowConflictScreen(false)
      setDuplicates([])
      onCardAdded()
      onClose()
    }
  }

  const duplicateItemsOnly = duplicates.filter(d => d.existing !== null)
  const allNew = duplicateItemsOnly.length > 0 && duplicateItemsOnly.every(d => d.choice === 'new')
  const allOld = duplicateItemsOnly.length > 0 && duplicateItemsOnly.every(d => d.choice === 'old')
  const countNew = duplicateItemsOnly.filter(d => d.choice === 'new').length
  const countOld = duplicateItemsOnly.filter(d => d.choice === 'old').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#1a1d23] border border-gray-800 p-6 shadow-2xl text-[#e6e8ec]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">
            {cardToEdit ? 'Редактировать карточку' : 'Добавить карточки'}
          </h3>
          <button
            onClick={onClose}
            className="text-[#8b90a0] hover:text-[#e6e8ec] text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {!cardToEdit && (
          <div className="flex border-b border-gray-800 mb-4">
            <button
              onClick={() => setActiveTab('manual')}
              className={`pb-2 px-4 text-sm font-medium transition border-b-2 ${
                activeTab === 'manual'
                  ? 'border-[#6c7cff] text-[#6c7cff]'
                  : 'border-transparent text-[#8b90a0] hover:text-[#e6e8ec]'
              }`}
            >
              Вручную
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`pb-2 px-4 text-sm font-medium transition border-b-2 ${
                activeTab === 'import'
                  ? 'border-[#6c7cff] text-[#6c7cff]'
                  : 'border-transparent text-[#8b90a0] hover:text-[#e6e8ec]'
              }`}
            >
              Текстовый импорт
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-[#a04a4a]/20 border border-[#a04a4a] p-3 text-sm">
            {error}
          </div>
        )}

        {activeTab === 'manual' || cardToEdit ? (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8b90a0] mb-1">
                Слово (англ) *
              </label>
              <input
                type="text"
                required
                value={word}
                onChange={e => handleWordChange(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-[#e6e8ec] focus:border-[#6c7cff] focus:outline-none"
                placeholder="apple"
              />
              {matchNotice && !cardToEdit && (
                <div className="mt-2 rounded-xl border border-[#6c7cff]/30 bg-[#0f1115] p-3 text-sm">
                  <p className="mb-2 text-[#e6e8ec]">{matchNotice}</p>
                  {existingMatches.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUseExistingData(existingMatches[0])}
                        className="rounded-lg bg-gray-800 px-3 py-1 text-xs hover:bg-gray-700 transition"
                      >
                        Использовать данные
                      </button>
                      <button
                        type="button"
                        onClick={handleLinkToAll}
                        className="rounded-lg bg-[#6c7cff]/20 text-[#6c7cff] px-3 py-1 text-xs hover:bg-[#6c7cff]/30 transition"
                      >
                        Связать со всеми копиями
                      </button>
                    </div>
                  )}
                </div>
              )}
              {linkToGroup && (
                <p className="mt-1 text-xs text-[#6c7cff]">🔗 Связано с другими копиями</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8b90a0] mb-1">
                Транскрипция
              </label>
              <input
                type="text"
                value={transcription}
                onChange={e => setTranscription(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-[#e6e8ec] focus:border-[#6c7cff] focus:outline-none"
                placeholder="[ˈæp.əl]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8b90a0] mb-1">
                Перевод *
              </label>
              <input
                type="text"
                required
                value={translation}
                onChange={e => setTranslation(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-[#e6e8ec] focus:border-[#6c7cff] focus:outline-none"
                placeholder="яблоко"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#8b90a0] mb-1">
                Примеры (каждый с новой строки)
              </label>
              <textarea
                rows={3}
                value={sentencesText}
                onChange={e => setSentencesText(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-[#e6e8ec] focus:border-[#6c7cff] focus:outline-none resize-none"
                placeholder="I like to eat a red apple."
              />
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-[#6c7cff] py-2.5 text-white font-medium hover:bg-[#5865e0] transition disabled:opacity-50"
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
                className="px-4 rounded-lg border border-gray-700 bg-transparent text-[#8b90a0] hover:text-[#e6e8ec] hover:border-gray-500 transition"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : showConflictScreen ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#232733] pb-3">
              <h4 className="text-sm font-semibold text-[#e6e8ec]">
                Найдены дубликаты: {duplicateItemsOnly.length}. Что использовать?
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDuplicates(prev =>
                      prev.map(d => (d.existing ? { ...d, choice: 'new' } : d))
                    )
                  }
                  className={`rounded px-2 py-1 text-xs border transition ${
                    allNew
                      ? 'bg-[#6c7cff]/20 border-[#6c7cff] text-[#6c7cff]'
                      : 'bg-[#1a1d23] border-[#232733] text-[#6c7cff] hover:bg-[#232733]'
                  }`}
                >
                  Для всех: Новое ({countNew})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDuplicates(prev =>
                      prev.map(d => (d.existing ? { ...d, choice: 'old' } : d))
                    )
                  }
                  className={`rounded px-2 py-1 text-xs border transition ${
                    allOld
                      ? 'bg-[#6c7cff]/20 border-[#6c7cff] text-[#e6e8ec]'
                      : 'bg-[#1a1d23] border-[#232733] text-[#8b90a0] hover:bg-[#232733]'
                  }`}
                >
                  Для всех: Старое ({countOld})
                </button>
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
              {duplicateItemsOnly.map(item => {
                const ext = item.existing!
                return (
                  <div
                    key={item.parsed.word}
                    className="rounded-xl border border-[#232733] bg-[#0f1115] p-3.5 space-y-2"
                  >
                    <div className="text-base font-bold text-[#e6e8ec]">
                      {item.parsed.word}
                    </div>

                    <div className="space-y-1.5 text-sm">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`conflict-${item.parsed.word}`}
                          checked={item.choice === 'new'}
                          onChange={() =>
                            setDuplicates(prev =>
                              prev.map(d =>
                                d.parsed.word === item.parsed.word
                                  ? { ...d, choice: 'new' }
                                  : d
                              )
                            )
                          }
                          className="mt-1 accent-[#6c7cff]"
                        />
                        <div>
                          <span className="text-[#8b90a0] text-xs uppercase tracking-wider block">
                            Новое:
                          </span>
                          <span>{item.parsed.translation}</span>
                          {item.parsed.transcription && (
                            <span className="text-[#8b90a0] ml-2">
                              ({item.parsed.transcription})
                            </span>
                          )}
                        </div>
                      </label>

                      <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-[#232733]/50">
                        <input
                          type="radio"
                          name={`conflict-${item.parsed.word}`}
                          checked={item.choice === 'old'}
                          onChange={() =>
                            setDuplicates(prev =>
                              prev.map(d =>
                                d.parsed.word === item.parsed.word
                                  ? { ...d, choice: 'old' }
                                  : d
                              )
                            )
                          }
                          className="mt-1 accent-[#6c7cff]"
                        />
                        <div className="text-[#8b90a0]">
                          <span className="text-xs uppercase tracking-wider block">
                            Старое:
                          </span>
                          <span className="text-[#e6e8ec]">{ext.translation}</span>
                          {ext.transcription && (
                            <span className="ml-2">({ext.transcription})</span>
                          )}
                          <span className="block text-xs text-[#6c7cff] mt-0.5">
                            (в папке "{ext.folderName}")
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex space-x-3 pt-2 border-t border-[#232733]">
              <button
                type="button"
                disabled={loading}
                onClick={() => executeFinalImport(duplicates)}
                className="flex-1 rounded-lg bg-[#6c7cff] py-2.5 text-white font-medium hover:bg-[#5865e0] transition disabled:opacity-50"
              >
                {loading ? 'Импорт...' : `Импортировать ${duplicates.length} слов`}
              </button>
              <button
                type="button"
                onClick={() => setShowConflictScreen(false)}
                className="px-4 rounded-lg border border-[#232733] bg-transparent text-[#8b90a0] hover:text-[#e6e8ec] hover:border-gray-500 transition"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleStartImportCheck} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#8b90a0] mb-1">
                Импорт через разделитель «|» (слово | транскрипция | перевод | пример 1 | пример 2)
              </label>
              <textarea
                rows={7}
                required
                value={importText}
                onChange={e => setImportText(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-[#0f1115] px-3 py-2 text-[#e6e8ec] font-mono text-sm focus:border-[#6c7cff] focus:outline-none resize-none"
                placeholder={`apple | /ˈæp.əl/ | яблоко | I eat an apple every day. | She bought two apples.\nbook | /bʊk/ | книга | This book is interesting. |`}
              />
            </div>

            {importText.trim() && (
              <div className="rounded-lg bg-[#0f1115] p-3 text-xs space-y-1 border border-gray-800">
                <p className="text-[#e6e8ec]">Будет создано карточек: {validCount}</p>
                {skippedCount > 0 && (
                  <p className="text-[#a04a4a]">Пропущено строк: {skippedCount}</p>
                )}
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                type="submit"
                disabled={loading || checkingDuplicates || validCount === 0}
                className="flex-1 rounded-lg bg-[#6c7cff] py-2.5 text-white font-medium hover:bg-[#5865e0] transition disabled:opacity-50"
              >
                {checkingDuplicates
                  ? 'Проверяю дубликаты...'
                  : loading
                  ? 'Импорт...'
                  : 'Импортировать слова'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 rounded-lg border border-gray-700 bg-transparent text-[#8b90a0] hover:text-[#e6e8ec] hover:border-gray-500 transition"
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