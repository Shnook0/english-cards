import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Card } from '@/types/database'
import { patchCorrect, patchWrong } from '@/lib/study'

const DAY_MS = 24 * 60 * 60 * 1000
const REPEAT_MIN_MINUTES = 15
const REPEAT_MAX_MINUTES = 20

const CARD_SELECT =
  'id, user_id, folder_id, word, transcription, translation, sentences, is_favorite, known_streak, wrong_count, srs_level, next_review_at, learned_at, created_at, sync_group_id, folders(name)'

export type TelegramSettings = {
  chat_id: number
  user_id: string
  timezone: string
  window_start: string
  window_end: string
  interval_minutes: number
  paused: boolean
  last_sent_at: string | null
}

export type BotCard = Card & {
  folder_name: string
}

type CardRow = Card & {
  folders: { name: string } | { name: string }[] | null
}

type PendingRepeat = {
  id: number
  chat_id: number
  card_id: string
  due_at: string
}

let adminClient: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (adminClient) return adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Не заданы NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY')
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return adminClient
}

function normalizeCard(row: CardRow): BotCard {
  const folder = Array.isArray(row.folders) ? row.folders[0] : row.folders
  return { ...row, folder_name: folder?.name ?? 'Без папки' } as BotCard
}

export async function getCard(cardId: string): Promise<BotCard | null> {
  const { data, error } = await db()
    .from('cards')
    .select(CARD_SELECT)
    .eq('id', cardId)
    .maybeSingle()
  if (error) throw error
  return data ? normalizeCard(data as unknown as CardRow) : null
}

export async function resolveOwnerUserId(): Promise<string | null> {
  if (process.env.OWNER_USER_ID) return process.env.OWNER_USER_ID

  const admin = db()
  const email = process.env.OWNER_EMAIL
  if (email) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) throw error
    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    return user?.id ?? null
  }

  const { data, error } = await admin.from('folders').select('user_id').limit(100)
  if (error) throw error
  const ids = Array.from(new Set(((data ?? []) as { user_id: string }[]).map(r => r.user_id)))
  return ids.length === 1 ? ids[0] : null
}

export async function getSettings(chatId: number): Promise<TelegramSettings | null> {
  const { data, error } = await db()
    .from('telegram_settings')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle()
  if (error) throw error
  return (data as TelegramSettings | null) ?? null
}

export async function ensureSettings(chatId: number): Promise<TelegramSettings> {
  const existing = await getSettings(chatId)
  if (existing) return existing

  const userId = await resolveOwnerUserId()
  if (!userId) {
    throw new Error('Не удалось определить user_id. Задай OWNER_USER_ID или OWNER_EMAIL.')
  }

  const { data, error } = await db()
    .from('telegram_settings')
    .upsert(
      {
        chat_id: chatId,
        user_id: userId,
        timezone: process.env.TELEGRAM_TIMEZONE || 'Europe/Moscow',
        interval_minutes: 60,
      },
      { onConflict: 'chat_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return data as TelegramSettings
}

export async function updateSettings(
  chatId: number,
  patch: Partial<TelegramSettings>
): Promise<void> {
  const { error } = await db()
    .from('telegram_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
  if (error) throw error
}

export async function listSettings(): Promise<TelegramSettings[]> {
  const { data, error } = await db().from('telegram_settings').select('*')
  if (error) throw error
  return (data ?? []) as TelegramSettings[]
}

function isHardCard(card: BotCard): boolean {
  const wrong = card.wrong_count || 0
  const srs = card.srs_level || 0
  const streak = card.known_streak || 0

  if (card.learned_at && wrong === 0) return false
  if (wrong > 0) return true
  return srs <= 1 && (srs > 0 || streak > 0)
}

function scoreCard(card: BotCard, now: number, avoidFolderId?: string): number {
  const wrong = card.wrong_count || 0
  const srs = card.srs_level || 0
  const streak = card.known_streak || 0
  const due = new Date(card.next_review_at).getTime() <= now ? 15 : 0
  const sameFolder = avoidFolderId && card.folder_id === avoidFolderId ? 30 : 0
  return wrong * 20 + (srs === 0 ? 10 : 0) + (streak === 0 ? 5 : 0) + due - sameFolder + Math.random() * 4
}

function pickFrom(cards: BotCard[], avoidFolderId?: string): BotCard | null {
  if (cards.length === 0) return null
  const now = Date.now()
  const sorted = [...cards].sort(
    (a, b) => scoreCard(b, now, avoidFolderId) - scoreCard(a, now, avoidFolderId)
  )
  const top = sorted.slice(0, Math.min(5, sorted.length))
  return top[Math.floor(Math.random() * top.length)]
}

export async function pickNextCard(userId: string, chatId: number): Promise<BotCard | null> {
  const admin = db()
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString()

  const { data: recentData, error: recentError } = await admin
    .from('telegram_deliveries')
    .select('card_id')
    .eq('chat_id', chatId)
    .gte('sent_at', since)
  if (recentError) throw recentError
  const recentIds = new Set(((recentData ?? []) as { card_id: string }[]).map(r => r.card_id))

  const { data: lastSent, error: lastError } = await admin
    .from('telegram_deliveries')
    .select('card_id')
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw lastError

  let avoidFolderId: string | undefined
  if (lastSent) {
    const { data: lastCard, error: lastCardError } = await admin
      .from('cards')
      .select('folder_id')
      .eq('id', (lastSent as { card_id: string }).card_id)
      .maybeSingle()
    if (lastCardError) throw lastCardError
    avoidFolderId = (lastCard as { folder_id: string } | null)?.folder_id
  }

  const { data, error } = await admin
    .from('cards')
    .select(CARD_SELECT)
    .eq('user_id', userId)
    .or('wrong_count.gt.0,srs_level.lte.1')
    .order('wrong_count', { ascending: false })
    .limit(500)
  if (error) throw error

  const candidates = ((data ?? []) as unknown as CardRow[])
    .map(normalizeCard)
    .filter(isHardCard)

  const fresh = candidates.filter(c => !recentIds.has(c.id))
  return pickFrom(fresh, avoidFolderId) ?? pickFrom(candidates, avoidFolderId)
}

export async function recordDelivery(
  chatId: number,
  cardId: string,
  kind: string
): Promise<void> {
  const { error } = await db().from('telegram_deliveries').insert({
    chat_id: chatId,
    card_id: cardId,
    kind,
  })
  if (error) console.error('telegram_deliveries:', error.message)
}

export async function addPendingRepeat(chatId: number, cardId: string): Promise<string> {
  const admin = db()
  const now = new Date()
  const minutes =
    REPEAT_MIN_MINUTES + Math.floor(Math.random() * (REPEAT_MAX_MINUTES - REPEAT_MIN_MINUTES + 1))
  const dueAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString()

  await admin
    .from('telegram_pending')
    .update({ sent_at: now.toISOString() })
    .eq('chat_id', chatId)
    .eq('card_id', cardId)
    .is('sent_at', null)

  const { error } = await admin.from('telegram_pending').insert({
    chat_id: chatId,
    card_id: cardId,
    due_at: dueAt,
  })
  if (error) throw error
  return dueAt
}

export async function listDuePending(): Promise<PendingRepeat[]> {
  const { data, error } = await db()
    .from('telegram_pending')
    .select('id, chat_id, card_id, due_at')
    .is('sent_at', null)
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(20)
  if (error) throw error
  return (data ?? []) as PendingRepeat[]
}

export async function markPendingSent(id: number): Promise<void> {
  const { error } = await db()
    .from('telegram_pending')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function applyBotResult(card: BotCard, correct: boolean): Promise<void> {
  const now = new Date()
  const patch = correct
    ? patchCorrect(card, false)
    : {
        ...patchWrong(card, false),
        next_review_at: new Date(now.getTime() + REPEAT_MIN_MINUTES * 60 * 1000).toISOString(),
      }

  const { error } = await db()
    .from('cards')
    .update(patch)
    .eq('id', card.id)
    .eq('user_id', card.user_id)
  if (error) throw error
}

export async function deleteCard(card: BotCard): Promise<void> {
  const { error } = await db()
    .from('cards')
    .delete()
    .eq('id', card.id)
    .eq('user_id', card.user_id)
  if (error) throw error
}

export type BotStats = {
  hard: number
  total: number
  pending: number
  sentWeek: number
}

export async function getStats(userId: string, chatId: number): Promise<BotStats> {
  const admin = db()
  const { data, error } = await admin
    .from('cards')
    .select('id, wrong_count, srs_level, known_streak, learned_at')
    .eq('user_id', userId)
    .limit(5000)
  if (error) throw error

  const rows = (data ?? []) as Pick<
    Card,
    'id' | 'wrong_count' | 'srs_level' | 'known_streak' | 'learned_at'
  >[]
  const hard = rows.filter(c => {
    const wrong = c.wrong_count || 0
    const srs = c.srs_level || 0
    const streak = c.known_streak || 0
    if (c.learned_at && wrong === 0) return false
    if (wrong > 0) return true
    return srs <= 1 && (srs > 0 || streak > 0)
  }).length

  const { count: pending, error: pendingError } = await admin
    .from('telegram_pending')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .is('sent_at', null)
  if (pendingError) throw pendingError

  const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
  const { count: sentWeek, error: sentError } = await admin
    .from('telegram_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .gte('sent_at', since)
  if (sentError) throw sentError

  return { hard, total: rows.length, pending: pending ?? 0, sentWeek: sentWeek ?? 0 }
}
