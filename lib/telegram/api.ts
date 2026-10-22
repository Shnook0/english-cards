export type InlineButton = {
  text: string
  callback_data?: string
  url?: string
}

export type InlineKeyboard = InlineButton[][]

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан')
  return token
}

export async function telegram<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => null)) as TelegramResponse<T> | null
  if (!data?.ok) {
    throw new Error(`Telegram ${method}: ${data?.description ?? `HTTP ${res.status}`}`)
  }
  return data.result as T
}

export function sendMessage(
  chatId: number | string,
  text: string,
  keyboard?: InlineKeyboard
): Promise<unknown> {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

export function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard
): Promise<unknown> {
  return telegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

export function removeKeyboard(chatId: number, messageId: number): Promise<unknown> {
  return telegram('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  })
}

export function answerCallbackQuery(id: string, text?: string): Promise<unknown> {
  return telegram('answerCallbackQuery', {
    callback_query_id: id,
    ...(text ? { text } : {}),
  })
}

export function setWebhook(url: string, secret: string): Promise<unknown> {
  return telegram('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  })
}
