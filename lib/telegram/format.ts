import type { InlineKeyboard } from './api'
import type { BotCard } from './store'

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function cardText(card: BotCard): string {
  const lines: string[] = []
  lines.push(`Папка: «${escapeHtml(card.folder_name)}»`)
  lines.push('')

  const transcription = card.transcription
    ? ` <i>/${escapeHtml(card.transcription)}</i>`
    : ''
  lines.push(`<b>${escapeHtml(card.word)}</b>${transcription}`)
  lines.push(`Перевод: ${escapeHtml(card.translation)}`)

  const sentences = (card.sentences ?? [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .slice(0, 3)

  if (sentences.length > 0) {
    lines.push('')
    lines.push('Примеры:')
    for (const sentence of sentences) {
      lines.push(`• ${escapeHtml(truncate(sentence, 350))}`)
    }
  }

  return lines.join('\n')
}

export function cardKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: 'Знаю', callback_data: `know:${cardId}` },
      { text: 'Не знаю', callback_data: `dont:${cardId}` },
      { text: 'Пропустить', callback_data: `skip:${cardId}` },
    ],
    [{ text: 'Удалить из папки', callback_data: `del:${cardId}` }],
  ]
}

export function deleteConfirmKeyboard(cardId: string): InlineKeyboard {
  return [
    [
      { text: 'Да, удалить', callback_data: `delyes:${cardId}` },
      { text: 'Отмена', callback_data: `delno:${cardId}` },
    ],
  ]
}
