import { randomBytes } from 'crypto'
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
  last_activity_at: string | null
  awaiting_input: string | null
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

export type DueReview = {
  id: number
  chat_id: number
  card_id: string
  stage: number
  due_at: string
}

export type UpcomingReview = {
  id: number
  due_at: string
  stage: number
  word: string
  translation: string
}

type UpcomingReviewRow = {
  id: number
  due_at: string
  stage: number
  cards: { word: string; translation: string } | { word: string; translation: string }[] | null
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

function isMissingBotSchema(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null
  if (!value) return false
  if (value.code === '42P01' || value.code === '42703') return true
  return /does not exist|schema cache/i.test(value.message ?? '')
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

  return createSettings(chatId, userId)
}

export async function createSettings(
  chatId: number,
  userId: string
): Promise<TelegramSettings> {
  const { data, error } = await db()
    .from('telegram_settings')
    .insert({
      chat_id: chatId,
      user_id: userId,
      timezone: process.env.TELEGRAM_TIMEZONE || 'Europe/Moscow',
      interval_minutes: 60,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as TelegramSettings
}

export async function getSettingsForUser(userId: string): Promise<TelegramSettings | null> {
  const { data, error } = await db()
    .from('telegram_settings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as TelegramSettings | undefined) ?? null
}

export async function createLinkCode(
  userId: string
): Promise<{ code: string; expires_at: string }> {
  const admin = db()
  const code = randomBytes(6).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  await admin
    .from('telegram_link_codes')
    .delete()
    .eq('user_id', userId)
    .is('used_at', null)

  const { error } = await admin.from('telegram_link_codes').insert({
    code,
    user_id: userId,
    expires_at: expiresAt,
  })
  if (error) throw error

  return { code, expires_at: expiresAt }
}

export async function consumeLinkCode(code: string): Promise<string | null> {
  const now = new Date().toISOString()
  const { data, error } = await db()
    .from('telegram_link_codes')
    .update({ used_at: now })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('user_id')
    .maybeSingle()
  if (error) throw error
  return (data as { user_id: string } | null)?.user_id ?? null
}

export async function bindChatToUser(
  chatId: number,
  userId: string
): Promise<{ ok: true; settings: TelegramSettings } | { ok: false; reason: 'taken' }> {
  const existing = await getSettings(chatId)
  if (existing) {
    if (existing.user_id !== userId) return { ok: false, reason: 'taken' }
    return { ok: true, settings: existing }
  }

  const settings = await createSettings(chatId, userId)
  return { ok: true, settings }
}

export async function updateSettings(
  chatId: number,
  patch: Partial<TelegramSettings>
): Promise<void> {
  const { error } = await db()
    .from('telegram_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
  if (!error) return

  if (!isMissingBotSchema(error)) throw error

  const fallback = { ...patch }
  delete fallback.last_activity_at
  delete fallback.awaiting_input

  if (Object.keys(fallback).length === 0) return

  const { error: fallbackError } = await db()
    .from('telegram_settings')
    .update({ ...fallback, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
  if (fallbackError) throw fallbackError
}

export async function touchActivity(chatId: number): Promise<void> {
  await updateSettings(chatId, { last_activity_at: new Date().toISOString() })
}

export async function listSettings(): Promise<TelegramSettings[]> {
  const { data, error } = await db().from('telegram_settings').select('*')
  if (error) throw error
  return (data ?? []) as TelegramSettings[]
}

export type DeliveryRow = {
  sent_at: string
  kind: string
}

export type PendingRow = {
  id: number
  due_at: string
  sent_at: string | null
}

export async function listRecentDeliveries(
  chatId: number,
  limit = 8
): Promise<DeliveryRow[]> {
  const { data, error } = await db()
    .from('telegram_deliveries')
    .select('sent_at, kind')
    .eq('chat_id', chatId)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as DeliveryRow[]
}

export async function listPendingForChat(chatId: number): Promise<PendingRow[]> {
  const { data, error } = await db()
    .from('telegram_pending')
    .select('id, due_at, sent_at')
    .eq('chat_id', chatId)
    .is('sent_at', null)
    .order('due_at', { ascending: true })
    .limit(20)
  if (error) throw error
  return (data ?? []) as PendingRow[]
}

type CustomFolder = {
  id: string
  name: string
  created_at: string
}

export async function getCustomFolders(userId: string): Promise<CustomFolder[]> {
  const { data, error } = await db()
    .from('folders')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .eq('type', 'custom')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CustomFolder[]
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
  const folders = await getCustomFolders(userId)
  if (folders.length === 0) return null

  const priorityFolderIds = new Set(folders.slice(0, 2).map(f => f.id))
  const folderIds = folders.map(f => f.id)
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString()

  const { data: recentData, error: recentError } = await admin
    .from('telegram_deliveries')
    .select('card_id')
    .eq('chat_id', chatId)
    .gte('sent_at', since)
  if (recentError) throw recentError
  const recentIds = new Set(((recentData ?? []) as { card_id: string }[]).map(r => r.card_id))

  const { data: reviewData, error: reviewError } = await admin
    .from('telegram_reviews')
    .select('card_id')
    .eq('chat_id', chatId)
    .is('sent_at', null)
  if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError
  const reviewIds = new Set(
    ((reviewData ?? []) as { card_id: string }[]).map(r => r.card_id),
  )

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
    .in('folder_id', folderIds)
    .or('wrong_count.gt.0,srs_level.lte.1')
    .order('wrong_count', { ascending: false })
    .limit(500)
  if (error) throw error

  const candidates = ((data ?? []) as unknown as CardRow[])
    .map(normalizeCard)
    .filter(isHardCard)
    .filter(card => !reviewIds.has(card.id))

  const priority = candidates.filter(c => priorityFolderIds.has(c.folder_id))
  const other = candidates.filter(c => !priorityFolderIds.has(c.folder_id))

  const freshPriority = priority.filter(c => !recentIds.has(c.id))
  const freshOther = other.filter(c => !recentIds.has(c.id))

  return (
    pickFrom(freshPriority, avoidFolderId) ??
    pickFrom(freshOther, avoidFolderId) ??
    pickFrom(priority, avoidFolderId) ??
    pickFrom(other, avoidFolderId)
  )
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

export async function clearCardQueue(chatId: number, cardId: string): Promise<void> {
  const admin = db()
  const now = new Date().toISOString()
  const { error: pendingError } = await admin
    .from('telegram_pending')
    .update({ sent_at: now })
    .eq('chat_id', chatId)
    .eq('card_id', cardId)
    .is('sent_at', null)
  if (pendingError) throw pendingError

  const { error: reviewError } = await admin
    .from('telegram_reviews')
    .update({ sent_at: now })
    .eq('chat_id', chatId)
    .eq('card_id', cardId)
    .is('sent_at', null)
  if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError
}

export async function replaceDontKnowReviews(
  chatId: number,
  cardId: string,
  schedule: { stage: number; dueAt: string }[],
): Promise<void> {
  await clearCardQueue(chatId, cardId)
  if (schedule.length === 0) return

  const { error } = await db().from('telegram_reviews').insert(
    schedule.map(item => ({
      chat_id: chatId,
      card_id: cardId,
      stage: item.stage,
      due_at: item.dueAt,
    })),
  )
  if (error && !isMissingBotSchema(error)) throw error
  if (error) console.error('telegram_reviews:', error.message)
}

export async function listDueReviews(): Promise<DueReview[]> {
  const { data, error } = await db()
    .from('telegram_reviews')
    .select('id, chat_id, card_id, stage, due_at')
    .is('sent_at', null)
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(20)
  if (error) {
    if (isMissingBotSchema(error)) return []
    throw error
  }
  return (data ?? []) as DueReview[]
}

export async function markReviewSent(id: number): Promise<void> {
  const { error } = await db()
    .from('telegram_reviews')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function listUpcomingReviews(
  chatId: number,
  limit = 10,
): Promise<UpcomingReview[]> {
  const { data, error } = await db()
    .from('telegram_reviews')
    .select('id, due_at, stage, cards(word, translation)')
    .eq('chat_id', chatId)
    .is('sent_at', null)
    .order('due_at', { ascending: true })
    .limit(limit)
  if (error) {
    if (isMissingBotSchema(error)) return []
    throw error
  }

  return ((data ?? []) as unknown as UpcomingReviewRow[]).map(row => {
    const card = Array.isArray(row.cards) ? row.cards[0] : row.cards
    return {
      id: row.id,
      due_at: row.due_at,
      stage: row.stage,
      word: card?.word ?? 'Слово',
      translation: card?.translation ?? '',
    }
  })
}

export async function countUpcomingReviews(chatId: number): Promise<number> {
  const { count, error } = await db()
    .from('telegram_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .is('sent_at', null)
  if (error) throw error
  return count ?? 0
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
  reviews: number
  sentWeek: number
}

export async function getStats(userId: string, chatId: number): Promise<BotStats> {
  const admin = db()
  const folders = await getCustomFolders(userId)
  const folderIds = folders.map(f => f.id)

  let rows: Pick<Card, 'id' | 'wrong_count' | 'srs_level' | 'known_streak' | 'learned_at'>[] = []
  if (folderIds.length > 0) {
    const { data, error } = await admin
      .from('cards')
      .select('id, wrong_count, srs_level, known_streak, learned_at')
      .eq('user_id', userId)
      .in('folder_id', folderIds)
      .limit(5000)
    if (error) throw error
    rows = (data ?? []) as Pick<
      Card,
      'id' | 'wrong_count' | 'srs_level' | 'known_streak' | 'learned_at'
    >[]
  }
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

  const { count: reviews, error: reviewsError } = await admin
    .from('telegram_reviews')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .is('sent_at', null)
  if (reviewsError && !isMissingBotSchema(reviewsError)) throw reviewsError

  const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
  const { count: sentWeek, error: sentError } = await admin
    .from('telegram_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .gte('sent_at', since)
  if (sentError) throw sentError

  return {
    hard,
    total: rows.length,
    pending: pending ?? 0,
    reviews: reviews ?? 0,
    sentWeek: sentWeek ?? 0,
  }
}
