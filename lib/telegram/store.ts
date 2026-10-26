import { randomBytes } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Card } from '@/types/database'
import { patchCorrect, patchWrong } from '@/lib/study'
import {
  followUpDueAt,
  IGNORED_FOLLOW_UP_STAGE,
  nextIgnoredIntervalDays,
  SITE_FOLLOW_UP_STAGE,
} from './schedule'

const DAY_MS = 24 * 60 * 60 * 1000
const REPEAT_MIN_MINUTES = 15
const REPEAT_MAX_MINUTES = 20

const CARD_SELECT =
  'id, user_id, folder_id, word, transcription, translation, sentences, is_favorite, known_streak, wrong_count, srs_level, next_review_at, learned_at, created_at, sync_group_id, folders(name)'

export type RevealMode = 'open' | 'spoiler'

export type TelegramSettings = {
  chat_id: number
  user_id: string
  timezone: string
  window_start: string
  window_end: string
  interval_minutes: number
  paused: boolean
  last_sent_at: string | null
  awaiting_input: string | null
  linked: boolean
  reveal_mode: RevealMode
}

export type BotCard = Card & {
  folder_name: string
}

type CardRow = Card & {
  folders: { name: string } | { name: string }[] | null
}

export type PendingRepeat = {
  id: number
  user_id: string
  card_id: string
  due_at: string
  stage: number | null
}

export type DueReview = {
  id: number
  user_id: string
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
  if (
    value.code === '42P01' ||
    value.code === '42703' ||
    value.code === 'PGRST204' ||
    value.code === 'PGRST205'
  ) {
    return true
  }
  return /does not exist|schema cache/i.test(value.message ?? '')
}

type Embedded<T> = T | T[] | null

function firstEmbedded<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function normalizeCard(row: CardRow): BotCard {
  const folder = firstEmbedded(row.folders)
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

export async function getChatSettings(chatId: number): Promise<TelegramSettings | null> {
  const { data, error } = await db()
    .from('telegram_settings')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle()
  if (error) throw error
  return (data as TelegramSettings | null) ?? null
}

export async function getSettings(chatId: number): Promise<TelegramSettings | null> {
  const { data, error } = await db()
    .from('telegram_settings')
    .select('*')
    .eq('chat_id', chatId)
    .eq('linked', true)
    .maybeSingle()
  if (error) throw error
  return (data as TelegramSettings | null) ?? null
}

export async function ensureSettings(chatId: number): Promise<TelegramSettings> {
  const existing = await getChatSettings(chatId)
  if (existing) {
    if (!existing.linked) {
      await updateSettings(chatId, { linked: true })
      return { ...existing, linked: true }
    }
    return existing
  }

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
    .order('linked', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as TelegramSettings | undefined) ?? null
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await db().auth.admin.getUserById(userId)
  if (error) return null
  return data.user?.email ?? null
}

export type BindChatResult =
  | { ok: true; settings: TelegramSettings }
  | { ok: false; reason: 'taken' }
  | { ok: false; reason: 'already_linked'; email: string | null }

export async function unlinkUser(userId: string): Promise<number[]> {
  const admin = db()
  const { data, error } = await admin
    .from('telegram_settings')
    .select('chat_id')
    .eq('user_id', userId)
    .eq('linked', true)
  if (error) throw error

  const chats = ((data ?? []) as { chat_id: number }[]).map(row => row.chat_id)
  if (chats.length === 0) return []

  const { error: updateError } = await admin
    .from('telegram_settings')
    .update({ linked: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('linked', true)
  if (updateError) throw updateError

  return chats
}

export async function muteCard(userId: string, cardId: string): Promise<void> {
  const { error } = await db()
    .from('telegram_muted_cards')
    .upsert(
      { user_id: userId, card_id: cardId },
      { onConflict: 'user_id,card_id', ignoreDuplicates: true }
    )
  if (error) throw error
}

export async function getMutedCardIds(userId: string): Promise<Set<string>> {
  const { data, error } = await db()
    .from('telegram_muted_cards')
    .select('card_id')
    .eq('user_id', userId)
  if (error) {
    if (isMissingBotSchema(error)) return new Set()
    throw error
  }
  return new Set(((data ?? []) as { card_id: string }[]).map(row => row.card_id))
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
): Promise<BindChatResult> {
  const existing = await getChatSettings(chatId)
  if (existing && existing.linked && existing.user_id !== userId) {
    return { ok: false, reason: 'taken' }
  }

  const userSettings = await getSettingsForUser(userId)

  if (userSettings && userSettings.chat_id !== chatId) {
    if (userSettings.linked) {
      return {
        ok: false,
        reason: 'already_linked',
        email: await getUserEmail(userId),
      }
    }

    if (existing && existing.chat_id === chatId) {
      const { error } = await db()
        .from('telegram_settings')
        .delete()
        .eq('chat_id', chatId)
      if (error) throw error
    }

    const { error } = await db()
      .from('telegram_settings')
      .update({
        chat_id: chatId,
        linked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('chat_id', userSettings.chat_id)
    if (error) throw error

    const settings = await getChatSettings(chatId)
    if (!settings) throw new Error('Не удалось перепривязать Telegram-аккаунт')
    return { ok: true, settings }
  }

  if (userSettings) {
    if (!userSettings.linked) {
      await updateSettings(chatId, { linked: true })
      return { ok: true, settings: { ...userSettings, linked: true } }
    }
    return { ok: true, settings: userSettings }
  }

  if (existing) {
    const { error } = await db().from('telegram_settings').delete().eq('chat_id', chatId)
    if (error) throw error
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
  delete fallback.awaiting_input

  if (Object.keys(fallback).length === 0) return

  const { error: fallbackError } = await db()
    .from('telegram_settings')
    .update({ ...fallback, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId)
  if (fallbackError) throw fallbackError
}

export async function listSettings(): Promise<TelegramSettings[]> {
  const { data, error } = await db()
    .from('telegram_settings')
    .select('*')
    .eq('linked', true)
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
  stage: number | null
  word: string
}

type PendingDbRow = {
  id: number
  card_id: string
  due_at: string
  sent_at?: string | null
  stage?: number | null
  cards: { user_id: string; word: string } | { user_id: string; word: string }[] | null
}

let pendingStageSupported: boolean | null = null

export async function listRecentDeliveries(
  userId: string,
  limit = 8
): Promise<DeliveryRow[]> {
  const { data, error } = await db()
    .from('telegram_deliveries')
    .select('sent_at, kind, cards!inner(user_id)')
    .eq('cards.user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as DeliveryRow[]
}

function pendingSelect(withStage: boolean): string {
  const columns = withStage
    ? 'id, card_id, due_at, sent_at, stage'
    : 'id, card_id, due_at, sent_at'
  return `${columns}, cards!inner(user_id, word)`
}

export async function listPendingForUser(userId: string): Promise<PendingRow[]> {
  const build = (withStage: boolean) =>
    db()
      .from('telegram_pending')
      .select(pendingSelect(withStage))
      .eq('cards.user_id', userId)
      .is('sent_at', null)
      .order('due_at', { ascending: true })
      .limit(50)

  const useStage = pendingStageSupported !== false
  let { data, error } = await build(useStage)

  if (error && useStage && isMissingBotSchema(error)) {
    pendingStageSupported = false
    ;({ data, error } = await build(false))
  } else if (!error) {
    pendingStageSupported = true
  }
  if (error) throw error

  return ((data ?? []) as unknown as PendingDbRow[]).map(row => ({
    id: row.id,
    due_at: row.due_at,
    sent_at: row.sent_at ?? null,
    stage: row.stage ?? null,
    word: firstEmbedded(row.cards)?.word ?? 'Слово',
  }))
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

type PracticeFields = Pick<
  Card,
  'wrong_count' | 'srs_level' | 'known_streak' | 'learned_at' | 'next_review_at'
>

function isPracticeCard(card: PracticeFields, now = Date.now()): boolean {
  const wrong = card.wrong_count || 0
  const srs = card.srs_level || 0
  const streak = card.known_streak || 0

  if (wrong > 0) return true
  if (card.learned_at) return false
  if (srs === 0 && streak === 0) return true
  if (srs <= 1) return true
  return new Date(card.next_review_at).getTime() <= now
}

function scoreCard(
  card: BotCard,
  now: number,
  avoidFolderId: string | undefined,
  folderLastSent: Map<string, number>,
): number {
  const wrong = card.wrong_count || 0
  const srs = card.srs_level || 0
  const streak = card.known_streak || 0
  const due = new Date(card.next_review_at).getTime() <= now ? 15 : 0
  const sameFolder = avoidFolderId && card.folder_id === avoidFolderId ? 30 : 0
  const lastFolder = folderLastSent.get(card.folder_id)
  const folderBonus =
    lastFolder === undefined
      ? 20
      : Math.min(20, Math.floor((now - lastFolder) / DAY_MS) * 2)

  return (
    wrong * 20 +
    (srs === 0 ? 10 : 0) +
    (streak === 0 ? 5 : 0) +
    due -
    sameFolder +
    folderBonus +
    Math.random() * 4
  )
}

function pickFrom(
  cards: BotCard[],
  avoidFolderId?: string,
  folderLastSent = new Map<string, number>(),
): BotCard | null {
  if (cards.length === 0) return null
  const now = Date.now()
  const sorted = [...cards].sort(
    (a, b) =>
      scoreCard(b, now, avoidFolderId, folderLastSent) -
      scoreCard(a, now, avoidFolderId, folderLastSent),
  )
  const top = sorted.slice(0, Math.min(5, sorted.length))
  return top[Math.floor(Math.random() * top.length)]
}

type DeliveryCardRow = {
  card_id: string
  sent_at?: string
  cards:
    | { word: string; folder_id: string }
    | { word: string; folder_id: string }[]
    | null
}

function deliveryCard(row: DeliveryCardRow): { word: string; folder_id: string } | null {
  return firstEmbedded(row.cards)
}

type QueuedCardRow = {
  card_id: string
  cards: { word: string } | { word: string }[] | null
}

function queuedCardWord(row: QueuedCardRow): string | null {
  return firstEmbedded(row.cards)?.word ?? null
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function pickNextCard(userId: string): Promise<BotCard | null> {
  const admin = db()
  const folders = await getCustomFolders(userId)
  if (folders.length === 0) return null

  const folderIds = folders.map(f => f.id)
  const mutedIds = await getMutedCardIds(userId)
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString()

  const { data: recentData, error: recentError } = await admin
    .from('telegram_deliveries')
    .select('card_id, sent_at, cards!inner(word, folder_id)')
    .eq('cards.user_id', userId)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
  if (recentError) throw recentError

  const recentRows = (recentData ?? []) as unknown as DeliveryCardRow[]
  const recentIds = new Set(recentRows.map(row => row.card_id))
  const recentWords = new Set(
    recentRows
      .map(row => deliveryCard(row)?.word)
      .filter((word): word is string => Boolean(word))
      .map(normalizeWord),
  )

  const folderSince = new Date(Date.now() - 14 * DAY_MS).toISOString()
  const { data: folderData, error: folderError } = await admin
    .from('telegram_deliveries')
    .select('sent_at, cards!inner(word, folder_id)')
    .eq('cards.user_id', userId)
    .gte('sent_at', folderSince)
    .order('sent_at', { ascending: false })
    .limit(300)
  if (folderError) throw folderError

  const folderLastSent = new Map<string, number>()
  for (const row of (folderData ?? []) as unknown as DeliveryCardRow[]) {
    const folderId = deliveryCard(row)?.folder_id
    if (!folderId || folderLastSent.has(folderId)) continue
    folderLastSent.set(folderId, new Date(row.sent_at ?? 0).getTime())
  }

  const { data: reviewData, error: reviewError } = await admin
    .from('telegram_reviews')
    .select('card_id, cards!inner(word)')
    .eq('cards.user_id', userId)
    .is('sent_at', null)
  if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError

  const { data: pendingData, error: pendingError } = await admin
    .from('telegram_pending')
    .select('card_id, cards!inner(word)')
    .eq('cards.user_id', userId)
    .is('sent_at', null)
  if (pendingError && !isMissingBotSchema(pendingError)) throw pendingError

  const queuedRows = [
    ...((reviewData ?? []) as unknown as QueuedCardRow[]),
    ...((pendingData ?? []) as unknown as QueuedCardRow[]),
  ]
  const queuedIds = new Set(queuedRows.map(row => row.card_id))
  const queuedWords = new Set(
    queuedRows
      .map(row => queuedCardWord(row))
      .filter((word): word is string => Boolean(word))
      .map(normalizeWord),
  )

  const lastDelivery = recentRows[0] ?? null
  const lastCard = lastDelivery ? deliveryCard(lastDelivery) : null
  const avoidFolderId = lastCard?.folder_id
  const lastCardId = lastDelivery?.card_id ?? null
  const lastWord = lastCard ? normalizeWord(lastCard.word) : null

  const { data, error } = await admin
    .from('cards')
    .select(CARD_SELECT)
    .eq('user_id', userId)
    .in('folder_id', folderIds)
    .limit(5000)
  if (error) throw error

  const candidates = ((data ?? []) as unknown as CardRow[])
    .map(normalizeCard)
    .filter(card => isPracticeCard(card))
    .filter(card => !queuedIds.has(card.id))
    .filter(card => !queuedWords.has(normalizeWord(card.word)))
    .filter(card => !mutedIds.has(card.id))
    .filter(card => card.id !== lastCardId)
    .filter(card => !lastWord || normalizeWord(card.word) !== lastWord)

  const isFresh = (card: BotCard) =>
    !recentIds.has(card.id) && !recentWords.has(normalizeWord(card.word))

  return (
    pickFrom(candidates.filter(isFresh), avoidFolderId, folderLastSent) ??
    pickFrom(candidates, avoidFolderId, folderLastSent)
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

export async function clearCardsQueue(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return

  const admin = db()
  const now = new Date().toISOString()
  const { error: pendingError } = await admin
    .from('telegram_pending')
    .update({ sent_at: now })
    .in('card_id', cardIds)
    .is('sent_at', null)
  if (pendingError) throw pendingError

  const { error: reviewError } = await admin
    .from('telegram_reviews')
    .update({ sent_at: now })
    .in('card_id', cardIds)
    .is('sent_at', null)
  if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError
}

export async function clearCardQueue(cardId: string): Promise<void> {
  await clearCardsQueue([cardId])
}

export async function getWordCards(userId: string, word: string): Promise<BotCard[]> {
  const target = normalizeWord(word)
  const folders = await getCustomFolders(userId)
  if (folders.length === 0) return []

  const { data, error } = await db()
    .from('cards')
    .select(CARD_SELECT)
    .eq('user_id', userId)
    .in('folder_id', folders.map(folder => folder.id))
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) throw error

  return ((data ?? []) as unknown as CardRow[])
    .map(normalizeCard)
    .filter(card => normalizeWord(card.word) === target)
}

export async function getDeliveryGapDays(cardIds: string[]): Promise<number | null> {
  if (cardIds.length === 0) return null

  const { data, error } = await db()
    .from('telegram_deliveries')
    .select('sent_at')
    .in('card_id', cardIds)
    .order('sent_at', { ascending: false })
    .limit(20)
  if (error) throw error

  const times = Array.from(
    new Set(((data ?? []) as { sent_at: string }[]).map(row => row.sent_at)),
  )
    .map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value))

  if (times.length < 2) return null
  return (times[0] - times[1]) / DAY_MS
}

export async function hasUnsentQueue(cardIds: string[]): Promise<boolean> {
  if (cardIds.length === 0) return false

  const admin = db()
  const { data, error } = await admin
    .from('telegram_pending')
    .select('id')
    .in('card_id', cardIds)
    .is('sent_at', null)
    .limit(1)
  if (error) throw error
  if ((data ?? []).length > 0) return true

  const { data: reviewData, error: reviewError } = await admin
    .from('telegram_reviews')
    .select('id')
    .in('card_id', cardIds)
    .is('sent_at', null)
    .limit(1)
  if (reviewError) {
    if (isMissingBotSchema(reviewError)) return false
    throw reviewError
  }
  return (reviewData ?? []).length > 0
}

type UnsentQueueIds = {
  pending: number[]
  reviews: number[]
}

async function getUnsentQueueIds(cardId: string): Promise<UnsentQueueIds> {
  const admin = db()

  const { data: pendingData, error: pendingError } = await admin
    .from('telegram_pending')
    .select('id')
    .eq('card_id', cardId)
    .is('sent_at', null)
  if (pendingError) throw pendingError

  const { data: reviewData, error: reviewError } = await admin
    .from('telegram_reviews')
    .select('id')
    .eq('card_id', cardId)
    .is('sent_at', null)
  if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError

  return {
    pending: ((pendingData ?? []) as { id: number }[]).map(row => row.id),
    reviews: ((reviewData ?? []) as { id: number }[]).map(row => row.id),
  }
}

type PendingInsert = {
  dueAt: string
  stage?: number | null
}

async function insertPendingRows(
  chatId: number,
  cardId: string,
  rows: PendingInsert[],
): Promise<void> {
  if (rows.length === 0) return

  const insert = (withStage: boolean) =>
    db()
      .from('telegram_pending')
      .insert(
        rows.map(item => ({
          chat_id: chatId,
          card_id: cardId,
          due_at: item.dueAt,
          ...(withStage && item.stage !== undefined && item.stage !== null
            ? { stage: item.stage }
            : {}),
        })),
      )

  const useStage = pendingStageSupported !== false
  let { error } = await insert(useStage)

  if (error && useStage && isMissingBotSchema(error)) {
    pendingStageSupported = false
    ;({ error } = await insert(false))
  } else if (!error) {
    pendingStageSupported = true
  }
  if (error) throw error
}

export async function insertFollowUp(
  chatId: number,
  cardId: string,
  dueAt: string,
  stage: number,
): Promise<void> {
  await insertPendingRows(chatId, cardId, [{ dueAt, stage }])
}

export async function replaceDontKnowQueue(
  chatId: number,
  cardId: string,
  schedule: { stage: number; dueAt: string }[],
): Promise<void> {
  if (schedule.length === 0) {
    await clearCardQueue(cardId)
    return
  }

  const oldQueue = await getUnsentQueueIds(cardId)
  await insertPendingRows(chatId, cardId, schedule)

  const now = new Date().toISOString()
  if (oldQueue.pending.length > 0) {
    const { error: pendingError } = await db()
      .from('telegram_pending')
      .update({ sent_at: now })
      .in('id', oldQueue.pending)
    if (pendingError) throw pendingError
  }
  if (oldQueue.reviews.length > 0) {
    const { error: reviewError } = await db()
      .from('telegram_reviews')
      .update({ sent_at: now })
      .in('id', oldQueue.reviews)
    if (reviewError && !isMissingBotSchema(reviewError)) throw reviewError
  }
}

export async function finishDelivery(
  chatId: number,
  userId: string,
  card: BotCard,
  settings: TelegramSettings,
  options: { initialIgnore?: boolean } = {},
): Promise<void> {
  const mutedIds = await getMutedCardIds(userId)
  if (mutedIds.has(card.id)) return

  const wordCards = await getWordCards(userId, card.word)
  const ids = wordCards.length > 0 ? wordCards.map(item => item.id) : [card.id]

  if (await hasUnsentQueue(ids)) return

  const gapDays = await getDeliveryGapDays(ids)
  const days = options.initialIgnore
    ? nextIgnoredIntervalDays(null)
    : nextIgnoredIntervalDays(gapDays)
  const dueAt = followUpDueAt(settings, days)

  await insertFollowUp(chatId, card.id, dueAt.toISOString(), IGNORED_FOLLOW_UP_STAGE)
}

// Ставит слово в обычную очередь повторов бота (вне ветки «Не знаю» из Telegram).
export async function queueRegularRepeat(userId: string, cardId: string): Promise<boolean> {
  const settings = await getSettingsForUser(userId)
  if (!settings || !settings.linked) return false

  const card = await getCard(cardId)
  if (!card || card.user_id !== userId) return false

  const mutedIds = await getMutedCardIds(userId)
  if (mutedIds.has(card.id)) return false

  const wordCards = await getWordCards(userId, card.word)
  const ids = wordCards.length > 0 ? wordCards.map(item => item.id) : [card.id]

  // Если у бота уже есть неотправленный повтор этого слова — не дублируем
  if (await hasUnsentQueue(ids)) return false

  const gapDays = await getDeliveryGapDays(ids)
  const days = nextIgnoredIntervalDays(gapDays)
  const dueAt = followUpDueAt(settings, days)

  await insertFollowUp(settings.chat_id, card.id, dueAt.toISOString(), SITE_FOLLOW_UP_STAGE)
  return true
}

type DueReviewRow = {
  id: number
  card_id: string
  stage: number
  due_at: string
  cards: { user_id: string } | { user_id: string }[] | null
}

export async function listDueReviews(userIds?: string[]): Promise<DueReview[]> {
  if (userIds && userIds.length === 0) return []

  const base = db()
    .from('telegram_reviews')
    .select('id, card_id, stage, due_at, cards!inner(user_id)')
    .is('sent_at', null)
    .lte('due_at', new Date().toISOString())

  const { data, error } = await (userIds ? base.in('cards.user_id', userIds) : base)
    .order('due_at', { ascending: true })
    .limit(20)
  if (error) {
    if (isMissingBotSchema(error)) return []
    throw error
  }

  return ((data ?? []) as unknown as DueReviewRow[]).flatMap(row => {
    const userId = firstEmbedded(row.cards)?.user_id
    if (!userId) return []
    return [
      {
        id: row.id,
        user_id: userId,
        card_id: row.card_id,
        stage: row.stage,
        due_at: row.due_at,
      },
    ]
  })
}

export async function markReviewSent(id: number): Promise<void> {
  const { error } = await db()
    .from('telegram_reviews')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function listUpcomingReviews(
  userId: string,
  limit = 10,
): Promise<UpcomingReview[]> {
  const { data, error } = await db()
    .from('telegram_reviews')
    .select('id, due_at, stage, cards!inner(word, translation)')
    .eq('cards.user_id', userId)
    .is('sent_at', null)
    .order('due_at', { ascending: true })
    .limit(limit)
  if (error) {
    if (isMissingBotSchema(error)) return []
    throw error
  }

  return ((data ?? []) as unknown as UpcomingReviewRow[]).map(row => {
    const card = firstEmbedded(row.cards)
    return {
      id: row.id,
      due_at: row.due_at,
      stage: row.stage,
      word: card?.word ?? 'Слово',
      translation: card?.translation ?? '',
    }
  })
}

export async function countUpcomingReviews(userId: string): Promise<number> {
  const { count, error } = await db()
    .from('telegram_reviews')
    .select('id, cards!inner(user_id)', { count: 'exact', head: true })
    .eq('cards.user_id', userId)
    .is('sent_at', null)
  if (error) throw error
  return count ?? 0
}

export async function listDuePending(userIds?: string[]): Promise<PendingRepeat[]> {
  if (userIds && userIds.length === 0) return []

  const build = (withStage: boolean) => {
    const base = db()
      .from('telegram_pending')
      .select(pendingSelect(withStage))
      .is('sent_at', null)
      .lte('due_at', new Date().toISOString())

    return (userIds ? base.in('cards.user_id', userIds) : base)
      .order('due_at', { ascending: true })
      .limit(50)
  }

  const useStage = pendingStageSupported !== false
  let { data, error } = await build(useStage)

  if (error && useStage && isMissingBotSchema(error)) {
    pendingStageSupported = false
    ;({ data, error } = await build(false))
  } else if (!error) {
    pendingStageSupported = true
  }
  if (error) throw error

  return ((data ?? []) as unknown as PendingDbRow[]).flatMap(row => {
    const userId = firstEmbedded(row.cards)?.user_id
    if (!userId) return []
    return [
      {
        id: row.id,
        user_id: userId,
        card_id: row.card_id,
        due_at: row.due_at,
        stage: row.stage ?? null,
      },
    ]
  })
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

export async function getStats(userId: string): Promise<BotStats> {
  const admin = db()
  const folders = await getCustomFolders(userId)
  const folderIds = folders.map(f => f.id)

  let rows: (PracticeFields & { id: string })[] = []
  if (folderIds.length > 0) {
    const { data, error } = await admin
      .from('cards')
      .select('id, wrong_count, srs_level, known_streak, learned_at, next_review_at')
      .eq('user_id', userId)
      .in('folder_id', folderIds)
      .limit(5000)
    if (error) throw error
    rows = (data ?? []) as (PracticeFields & { id: string })[]
  }
  const hard = rows.filter(card => isPracticeCard(card)).length

  const { count: pending, error: pendingError } = await admin
    .from('telegram_pending')
    .select('id, cards!inner(user_id)', { count: 'exact', head: true })
    .eq('cards.user_id', userId)
    .is('sent_at', null)
  if (pendingError) throw pendingError

  const { count: reviews, error: reviewsError } = await admin
    .from('telegram_reviews')
    .select('id, cards!inner(user_id)', { count: 'exact', head: true })
    .eq('cards.user_id', userId)
    .is('sent_at', null)
  if (reviewsError && !isMissingBotSchema(reviewsError)) throw reviewsError

  const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
  const { count: sentWeek, error: sentError } = await admin
    .from('telegram_deliveries')
    .select('id, cards!inner(user_id)', { count: 'exact', head: true })
    .eq('cards.user_id', userId)
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
