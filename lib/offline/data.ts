import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { supabase } from '@/lib/supabase'
import { getDb, setMeta } from '@/lib/offline/db'
import {
  isNetworkError,
  isOnline,
  isReadOnline,
  markSnapshotFresh,
  noteNetworkFailure,
  noteNetworkSuccess,
  newId,
} from '@/lib/offline/connectivity'
import { getPendingCount, enqueue } from '@/lib/offline/outbox'
import { recordConflict } from '@/lib/offline/conflicts'
import { resolveUserId } from '@/lib/offline/authCache'
import {
  isMissingColumn,
  remoteApplyCardAnswer,
  remoteApplyGeneralAnswer,
  remoteCreateCardIfMissing,
  remoteCreateTraining,
  remoteDeleteCard,
  remoteDeleteCardGroup,
  remoteDeleteFolder,
  remoteDeleteTraining,
  remoteResetWrong,
  remoteSaveBlocksRecord,
  remoteSaveMatchRecord,
  remoteSetFavorite,
  remoteUpdateCardContent,
} from '@/lib/offline/remotes'
import { patchCorrect, patchWrong } from '@/lib/study'
import {
  INTERVALS_DAYS,
  MISTAKE_DAYS,
  MISTAKE_STREAK_TO_CLEAR,
  wordKey,
} from '@/lib/general'
import { GeneralTrainingFolder, MatchRecordRow, BlocksRecordRow } from '@/lib/offline/db'

const PAGE = 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type CardQuery = {
  userId: string
  folderId?: string
  favorite?: boolean
  mistakes?: boolean
  learned?: boolean
  syncGroupId?: string
  order?: 'created_desc' | 'created_asc' | 'learned_asc' | 'wrong_desc'
}

function orderColumn(order: CardQuery['order']): 'created_at' | 'learned_at' | 'wrong_count' {
  if (order === 'learned_asc') return 'learned_at'
  if (order === 'wrong_desc') return 'wrong_count'
  return 'created_at'
}

function sortCards(cards: Card[], order: CardQuery['order'] = 'created_desc'): Card[] {
  const sorted = [...cards]
  sorted.sort((a, b) => {
    if (order === 'learned_asc') {
      const at = a.learned_at ? new Date(a.learned_at).getTime() : Number.MAX_SAFE_INTEGER
      const bt = b.learned_at ? new Date(b.learned_at).getTime() : Number.MAX_SAFE_INTEGER
      if (at !== bt) return at - bt
    } else if (order === 'wrong_desc') {
      if ((b.wrong_count ?? 0) !== (a.wrong_count ?? 0)) {
        return (b.wrong_count ?? 0) - (a.wrong_count ?? 0)
      }
    } else {
      const at = new Date(a.created_at).getTime()
      const bt = new Date(b.created_at).getTime()
      if (at !== bt) return order === 'created_asc' ? at - bt : bt - at
    }
    return a.id.localeCompare(b.id)
  })
  return sorted
}

async function localCards(query: CardQuery): Promise<Card[]> {
  let rows = await getDb().cards.where('user_id').equals(query.userId).toArray()
  if (query.folderId) rows = rows.filter(card => card.folder_id === query.folderId)
  if (query.favorite) rows = rows.filter(card => card.is_favorite)
  if (query.mistakes) rows = rows.filter(card => (card.wrong_count ?? 0) >= 2)
  if (query.learned) rows = rows.filter(card => !!card.learned_at)
  if (query.syncGroupId) rows = rows.filter(card => card.sync_group_id === query.syncGroupId)
  return sortCards(rows, query.order)
}

async function remoteCards(query: CardQuery): Promise<Card[]> {
  const rows: Card[] = []
  for (let from = 0; ; from += PAGE) {
    let request = supabase
      .from('cards')
      .select('*')
      .eq('user_id', query.userId)

    if (query.folderId) request = request.eq('folder_id', query.folderId)
    if (query.favorite) request = request.eq('is_favorite', true)
    if (query.mistakes) request = request.gte('wrong_count', 2)
    if (query.learned) request = request.not('learned_at', 'is', null)
    if (query.syncGroupId) request = request.eq('sync_group_id', query.syncGroupId)

    const { data, error } = await request
      .order(orderColumn(query.order), {
        ascending: query.order === 'created_asc' || query.order === 'learned_asc',
      })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw error
    const chunk = (data ?? []) as Card[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  noteNetworkSuccess()
  return rows
}

export async function fetchCards(query: CardQuery): Promise<Card[]> {
  const db = getDb()
  const local = await localCards(query)
  const pending = await getPendingCount().catch(() => 0)

  if (!isReadOnline() || (pending > 0 && local.length > 0)) return local

  try {
    const remote = await remoteCards(query)
    if (remote.length > 0) await db.cards.bulkPut(remote)
    return remote
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }
}

export async function fetchFolders(
  userId: string,
  type?: Folder['type']
): Promise<Folder[]> {
  const db = getDb()
  let local = await db.folders.where('user_id').equals(userId).toArray()
  if (type) local = local.filter(folder => folder.type === type)
  local.sort((a, b) => a.created_at.localeCompare(b.created_at))

  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local.length > 0)) return local

  const rows: Folder[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      let request = supabase.from('folders').select('*').eq('user_id', userId)
      if (type) request = request.eq('type', type)
      const { data, error } = await request
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as Folder[]
      rows.push(...chunk)
      if (chunk.length < PAGE) break
    }
    noteNetworkSuccess()
    if (rows.length > 0) await db.folders.bulkPut(rows)
    return rows
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }
}

export async function fetchFolder(folderId: string): Promise<Folder | null> {
  const db = getDb()
  const local = (await db.folders.get(folderId)) ?? null
  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local)) return local

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('id', folderId)
    .maybeSingle()

  if (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }

  noteNetworkSuccess()
  const folder = (data as Folder | null) ?? null
  if (folder) await db.folders.put(folder)
  return folder
}

export async function createFolder(
  userId: string,
  name: string,
  type: Folder['type'] = 'custom'
): Promise<Folder> {
  const folder: Folder = {
    id: newId(),
    user_id: userId,
    name,
    type,
    created_at: new Date().toISOString(),
  }

  const db = getDb()

  if (isOnline()) {
    try {
      const { data, error } = await supabase
        .from('folders')
        .insert(folder)
        .select('*')
        .single()

      if (!error && data) {
        noteNetworkSuccess()
        await db.folders.put(data as Folder)
        return data as Folder
      }

      if (error && !isNetworkError(error)) {
        throw new Error(error.message)
      }
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await db.folders.put(folder)
  await enqueue('folder_create', 'folder', folder.id, { folder })
  return folder
}

export async function deleteFolder(folderId: string): Promise<void> {
  const db = getDb()

  if (isOnline()) {
    try {
      await remoteDeleteFolder(folderId)
      await db.transaction('rw', [db.folders, db.cards], async () => {
        await db.folders.delete(folderId)
        const cards = await db.cards.where('folder_id').equals(folderId).toArray()
        if (cards.length > 0) await db.cards.bulkDelete(cards.map(card => card.id))
      })
      return
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await enqueue('folder_delete', 'folder', folderId, {})
  await db.transaction('rw', [db.folders, db.cards], async () => {
    await db.folders.delete(folderId)
    const cards = await db.cards.where('folder_id').equals(folderId).toArray()
    if (cards.length > 0) await db.cards.bulkDelete(cards.map(card => card.id))
  })
}

export type NewCardInput = {
  word: string
  transcription?: string | null
  translation: string
  sentences: string[]
}

export async function createCards(
  userId: string,
  folderId: string,
  inputs: NewCardInput[],
  options: { syncGroupId?: string | null } = {}
): Promise<Card[]> {
  const db = getDb()
  const now = new Date().toISOString()

  const rows: Card[] = inputs.map(input => ({
    id: newId(),
    user_id: userId,
    folder_id: folderId,
    word: input.word,
    transcription: input.transcription ?? null,
    translation: input.translation,
    sentences: input.sentences ?? [],
    is_favorite: false,
    known_streak: 0,
    wrong_count: 0,
    srs_level: 0,
    next_review_at: now,
    learned_at: null,
    created_at: now,
    sync_group_id: options.syncGroupId ?? null,
    content_updated_at: now,
    last_answer_at: null,
  }))

  if (rows.length === 0) return rows

  if (isOnline()) {
    const saved: Card[] = []

    for (let index = 0; index < rows.length; index += 200) {
      const chunk = rows.slice(index, index + 200)
      let { data, error } = await supabase.from('cards').insert(chunk).select('*')

      if (error && isMissingColumn(error)) {
        const stripped = chunk.map(card => {
          const next = { ...card }
          delete next.content_updated_at
          delete next.last_answer_at
          return next
        })
        const retry = await supabase.from('cards').insert(stripped).select('*')
        data = retry.data
        error = retry.error
      }

      if (error) {
        if (isNetworkError(error)) noteNetworkFailure()
        else throw new Error(error.message)
        break
      }

      saved.push(...((data ?? []) as Card[]))
    }

    if (saved.length === rows.length) {
      noteNetworkSuccess()
      await db.cards.bulkPut(saved)
      return saved
    }
  }

  await db.cards.bulkPut(rows)
  for (const card of rows) {
    await enqueue('card_create', 'card', card.id, { card })
  }
  return rows
}

export async function createCard(
  userId: string,
  folderId: string,
  input: NewCardInput,
  options: { syncGroupId?: string | null } = {}
): Promise<Card> {
  const [card] = await createCards(userId, folderId, [input], options)
  return card
}

export type UpdateCardResult =
  | { ok: true; card: Card }
  | { ok: false; conflict?: boolean; error?: string }

export async function updateCardContent(
  cardId: string,
  userId: string,
  patch: Partial<Card>,
  baseContentUpdatedAt?: string | null
): Promise<UpdateCardResult> {
  const db = getDb()
  const local = await db.cards.get(cardId)
  const base = baseContentUpdatedAt ?? local?.content_updated_at ?? null
  const now = new Date().toISOString()

  if (isOnline()) {
    try {
      const result = await remoteUpdateCardContent(cardId, patch, base)
      if (result.status === 'ok') {
        await db.cards.put(result.card)
        return { ok: true, card: result.card }
      }
      if (result.status === 'conflict') {
        await recordConflict(cardId, patch, result.remote, base)
        return {
          ok: false,
          conflict: true,
          error: 'Карточку изменили на другом устройстве. Откройте «Настройки → Конфликты».',
        }
      }
      return { ok: false, error: 'Карточка не найдена на сервере' }
    } catch (error) {
      if (!isNetworkError(error)) {
        return { ok: false, error: 'Не удалось сохранить карточку' }
      }
    }
  }

  const merged: Card = {
    ...(local ?? {
      id: cardId,
      user_id: userId,
      folder_id: '',
      word: '',
      translation: '',
      sentences: [],
      is_favorite: false,
      known_streak: 0,
      wrong_count: 0,
      srs_level: 0,
      next_review_at: now,
      created_at: now,
    }),
    ...patch,
    content_updated_at: now,
  }

  await db.cards.put(merged)
  await enqueue('card_update', 'card', cardId, { patch }, base)
  return { ok: true, card: merged }
}

export async function setFavorite(cardId: string, value: boolean): Promise<boolean> {
  const db = getDb()
  const local = await db.cards.get(cardId)

  if (local) await db.cards.put({ ...local, is_favorite: value })

  if (isOnline()) {
    try {
      await remoteSetFavorite(cardId, value)
      return true
    } catch (error) {
      if (!isNetworkError(error)) return false
    }
  }

  await enqueue('card_favorite', 'card', cardId, { value })
  return true
}

export async function resetWrongCount(cardId: string): Promise<boolean> {
  const db = getDb()
  const local = await db.cards.get(cardId)

  if (local) await db.cards.put({ ...local, wrong_count: 0 })

  if (isOnline()) {
    try {
      await remoteResetWrong(cardId)
      return true
    } catch (error) {
      if (!isNetworkError(error)) return false
    }
  }

  await enqueue('card_wrong_reset', 'card', cardId, {})
  return true
}

export async function deleteCard(cardId: string): Promise<void> {
  const db = getDb()

  if (isOnline()) {
    try {
      await remoteDeleteCard(cardId)
      await db.cards.delete(cardId)
      return
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await enqueue('card_delete', 'card', cardId, {})
  await db.cards.delete(cardId)
}

export async function deleteCardsByGroup(syncGroupId: string): Promise<void> {
  const db = getDb()
  const cards = await db.cards.where('sync_group_id').equals(syncGroupId).toArray()

  if (isOnline()) {
    try {
      await remoteDeleteCardGroup(syncGroupId)
      if (cards.length > 0) await db.cards.bulkDelete(cards.map(card => card.id))
      return
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await enqueue('card_delete_group', 'card', syncGroupId, { syncGroupId })
  if (cards.length > 0) await db.cards.bulkDelete(cards.map(card => card.id))
}

export async function saveCardAnswer(
  card: Card,
  correct: boolean,
  isLevel: boolean
): Promise<boolean> {
  const db = getDb()
  const local = (await db.cards.get(card.id)) ?? card
  const now = Date.now()
  const answeredAt = new Date(now).toISOString()
  const eventId = newId()
  const patch = correct ? patchCorrect(local, isLevel, now) : patchWrong(local, isLevel, now)

  if (isOnline()) {
    try {
      const row = await remoteApplyCardAnswer({
        eventId,
        cardId: card.id,
        correct,
        isLevel,
        answeredAt,
        patch,
      })
      if (row) {
        await db.cards.put(row)
        return true
      }
      return false
    } catch (error) {
      if (!isNetworkError(error)) return false
    }
  }

  const merged = { ...local, ...patch }
  await db.cards.put(merged)
  await enqueue(
    'card_answer',
    'card',
    card.id,
    { eventId, cardId: card.id, correct, isLevel, answeredAt, patch },
    local.content_updated_at ?? null
  )
  return true
}

export async function fetchGeneralTrainings(userId: string): Promise<GeneralTraining[]> {
  const db = getDb()
  const local = await db.general_trainings.where('user_id').equals(userId).toArray()
  local.sort((a, b) => b.created_at.localeCompare(a.created_at))

  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local.length > 0)) return local

  const rows: GeneralTraining[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('general_trainings')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as GeneralTraining[]
      rows.push(...chunk)
      if (chunk.length < PAGE) break
    }
    noteNetworkSuccess()
    if (rows.length > 0) await db.general_trainings.bulkPut(rows)
    return rows
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }
}

export async function fetchTraining(
  trainingId: string
): Promise<GeneralTraining | null> {
  const db = getDb()
  const local = (await db.general_trainings.get(trainingId)) ?? null
  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local)) return local

  const { data, error } = await supabase
    .from('general_trainings')
    .select('*')
    .eq('id', trainingId)
    .maybeSingle()

  if (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }

  noteNetworkSuccess()
  const training = (data as GeneralTraining | null) ?? null
  if (training) await db.general_trainings.put(training)
  return training
}

export async function fetchTrainingFolderIds(trainingId: string): Promise<string[]> {
  const db = getDb()
  const local = await db.general_training_folders
    .where('training_id')
    .equals(trainingId)
    .toArray()

  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local.length > 0)) {
    return local.map(row => row.folder_id)
  }

  const { data, error } = await supabase
    .from('general_training_folders')
    .select('folder_id')
    .eq('training_id', trainingId)

  if (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local.map(row => row.folder_id)
  }

  noteNetworkSuccess()
  const ids = ((data ?? []) as { folder_id: string }[]).map(row => row.folder_id)
  await db.transaction('rw', db.general_training_folders, async () => {
    await db.general_training_folders.where('training_id').equals(trainingId).delete()
    if (ids.length > 0) {
      await db.general_training_folders.bulkPut(
        ids.map(folderId => ({ training_id: trainingId, folder_id: folderId }))
      )
    }
  })
  return ids
}

export async function fetchGeneralTrainingFolders(
  userId: string
): Promise<Record<string, string[]>> {
  const trainings = await fetchGeneralTrainings(userId)
  const db = getDb()
  const map: Record<string, string[]> = {}

  const localRows = await db.general_training_folders.toArray()
  for (const row of localRows) {
    if (!map[row.training_id]) map[row.training_id] = []
    map[row.training_id].push(row.folder_id)
  }

  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || pending > 0 || trainings.length === 0) return map

  try {
    const ids = trainings.map(training => training.id)
    const { data, error } = await supabase
      .from('general_training_folders')
      .select('*')
      .in('training_id', ids)
    if (error) throw error
    noteNetworkSuccess()

    const rows = (data ?? []) as GeneralTrainingFolder[]
    const remoteMap: Record<string, string[]> = {}
    for (const row of rows) {
      if (!remoteMap[row.training_id]) remoteMap[row.training_id] = []
      remoteMap[row.training_id].push(row.folder_id)
    }

    await db.transaction('rw', db.general_training_folders, async () => {
      await db.general_training_folders.clear()
      if (rows.length > 0) await db.general_training_folders.bulkPut(rows)
    })
    return remoteMap
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return map
  }
}

export async function createGeneralTraining(
  userId: string,
  name: string,
  scope: GeneralTraining['scope'],
  folderIds: string[]
): Promise<GeneralTraining> {
  const db = getDb()
  const training: GeneralTraining = {
    id: newId(),
    user_id: userId,
    name,
    scope,
    created_at: new Date().toISOString(),
  }
  const links = (scope === 'custom' ? folderIds : []).map(folderId => ({
    training_id: training.id,
    folder_id: folderId,
  }))

  if (isOnline()) {
    try {
      await remoteCreateTraining(training, scope === 'custom' ? folderIds : [])
      await db.general_trainings.put(training)
      if (links.length > 0) await db.general_training_folders.bulkPut(links)
      return training
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await db.general_trainings.put(training)
  if (links.length > 0) await db.general_training_folders.bulkPut(links)
  await enqueue('general_create', 'training', training.id, {
    training,
    folderIds: scope === 'custom' ? folderIds : [],
  })
  return training
}

export async function deleteGeneralTraining(trainingId: string): Promise<void> {
  const db = getDb()

  if (isOnline()) {
    try {
      await remoteDeleteTraining(trainingId)
      await db.transaction(
        'rw',
        [db.general_trainings, db.general_training_folders, db.general_progress],
        async () => {
          await db.general_trainings.delete(trainingId)
          await db.general_training_folders.where('training_id').equals(trainingId).delete()
          await db.general_progress.where('training_id').equals(trainingId).delete()
        }
      )
      return
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  await enqueue('general_delete', 'training', trainingId, {})
  await db.transaction(
    'rw',
    [db.general_trainings, db.general_training_folders, db.general_progress],
    async () => {
      await db.general_trainings.delete(trainingId)
      await db.general_training_folders.where('training_id').equals(trainingId).delete()
      await db.general_progress.where('training_id').equals(trainingId).delete()
    }
  )
}

async function localTrainingCards(folderIds: string[]): Promise<Card[]> {
  if (folderIds.length === 0) return []
  const rows = await getDb().cards.where('folder_id').anyOf(folderIds).toArray()
  const seen = new Set<string>()
  const unique: Card[] = []
  const sorted = sortCards(rows, 'created_asc')
  for (const card of sorted) {
    const key = wordKey(card)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(card)
  }
  return unique
}

export async function fetchTrainingCards(
  training: GeneralTraining,
  userId: string
): Promise<Card[]> {
  let folderIds: string[] = []

  if (training.scope === 'all') {
    const folders = await fetchFolders(userId, 'custom')
    folderIds = folders.map(folder => folder.id)
  } else {
    folderIds = await fetchTrainingFolderIds(training.id)
  }

  if (folderIds.length === 0) return []

  const local = await localTrainingCards(folderIds)
  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || (pending > 0 && local.length > 0)) return local

  const all: Card[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('cards')
        .select('*')
        .in('folder_id', folderIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as Card[]
      all.push(...chunk)
      if (chunk.length < PAGE) break
    }
    noteNetworkSuccess()
    if (all.length > 0) await getDb().cards.bulkPut(all)
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }

  const seen = new Set<string>()
  const unique: Card[] = []
  for (const card of all) {
    const key = wordKey(card)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(card)
  }
  return unique
}

function progressToMap(rows: GeneralProgress[]): Record<string, GeneralProgress> {
  const map: Record<string, GeneralProgress> = {}
  for (const row of rows) map[row.word_key] = row
  return map
}

export async function fetchProgress(trainingId: string): Promise<Record<string, GeneralProgress>> {
  const db = getDb()
  const localRows = await db.general_progress.where('training_id').equals(trainingId).toArray()
  const local = progressToMap(localRows)

  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || pending > 0) return local

  const rows: GeneralProgress[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('general_progress')
        .select('*')
        .eq('training_id', trainingId)
        .order('word_key', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as GeneralProgress[]
      rows.push(...chunk)
      if (chunk.length < PAGE) break
    }
    noteNetworkSuccess()

    await db.transaction('rw', db.general_progress, async () => {
      await db.general_progress.where('training_id').equals(trainingId).delete()
      if (rows.length > 0) await db.general_progress.bulkPut(rows)
    })
    return progressToMap(rows)
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local
  }
}

export function defaultGeneralProgress(
  trainingId: string,
  userId: string,
  card: Card,
  at: number = Date.now()
): GeneralProgress {
  return {
    training_id: trainingId,
    word_key: wordKey(card),
    user_id: userId,
    level: 0,
    next_review_at: new Date(at).toISOString(),
    mistake_until: null,
    mistake_streak: 0,
    wrong_total: 0,
    updated_at: new Date(at).toISOString(),
  }
}

export function computeGeneralProgress(
  current: GeneralProgress,
  correct: boolean,
  at: number = Date.now()
): GeneralProgress {
  const lastIdx = INTERVALS_DAYS.length - 1

  if (correct) {
    const days = INTERVALS_DAYS[Math.min(current.level, lastIdx)]
    let mistakeUntil = current.mistake_until
    let streak = current.mistake_streak

    if (mistakeUntil && new Date(mistakeUntil).getTime() > at) {
      streak += 1
      if (streak >= MISTAKE_STREAK_TO_CLEAR) {
        mistakeUntil = null
        streak = 0
      }
    } else {
      mistakeUntil = null
      streak = 0
    }

    return {
      ...current,
      level: Math.min(current.level + 1, lastIdx),
      next_review_at: new Date(at + days * DAY_MS).toISOString(),
      mistake_until: mistakeUntil,
      mistake_streak: streak,
      updated_at: new Date(at).toISOString(),
    }
  }

  return {
    ...current,
    level: Math.max(current.level - 2, 0),
    next_review_at: new Date(at + INTERVALS_DAYS[0] * DAY_MS).toISOString(),
    mistake_until: new Date(at + MISTAKE_DAYS * DAY_MS).toISOString(),
    mistake_streak: 0,
    wrong_total: current.wrong_total + 1,
    updated_at: new Date(at).toISOString(),
  }
}

export async function saveGeneralAnswer(
  trainingId: string,
  card: Card,
  current: GeneralProgress | undefined,
  correct: boolean,
  userId: string
): Promise<GeneralProgress | null> {
  const db = getDb()
  const now = Date.now()
  const answeredAt = new Date(now).toISOString()
  const eventId = newId()
  const base = current ?? defaultGeneralProgress(trainingId, userId, card, now)
  const row = computeGeneralProgress(base, correct, now)

  if (isOnline()) {
    try {
      const saved = await remoteApplyGeneralAnswer({
        eventId,
        trainingId,
        wordKey: row.word_key,
        correct,
        answeredAt,
        fallback: row,
      })
      if (saved) {
        await db.general_progress.put(saved)
        return saved
      }
      return null
    } catch (error) {
      if (!isNetworkError(error)) return null
    }
  }

  await db.general_progress.put(row)
  await enqueue('general_answer', 'progress', `${trainingId}:${row.word_key}`, {
    eventId,
    trainingId,
    wordKey: row.word_key,
    correct,
    answeredAt,
    fallback: row,
  })
  return row
}

export async function fetchBestTime(scope: string): Promise<number | null> {
  const db = getDb()
  const userId = await resolveUserId()
  if (!userId) return null

  const local = await db.match_records.get([userId, scope])
  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || pending > 0) return local?.best_time ?? null

  const { data, error } = await supabase
    .from('match_records')
    .select('best_time')
    .eq('user_id', userId)
    .eq('scope', scope)
    .maybeSingle()

  if (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local?.best_time ?? null
  }

  noteNetworkSuccess()
  const time = data ? Number(data.best_time) : null
  if (time !== null && (!local || time < local.best_time)) {
    await db.match_records.put({
      user_id: userId,
      scope,
      best_time: time,
      updated_at: new Date().toISOString(),
    })
  }
  return time ?? local?.best_time ?? null
}

export async function saveBestTime(
  scope: string,
  time: number
): Promise<'saved' | 'not_better'> {
  const db = getDb()
  const userId = await resolveUserId()
  if (!userId) return 'not_better'

  const local = await db.match_records.get([userId, scope])
  if (local && local.best_time <= time) return 'not_better'

  if (isOnline()) {
    try {
      await remoteSaveMatchRecord(scope, time)
      const { data } = await supabase
        .from('match_records')
        .select('best_time')
        .eq('user_id', userId)
        .eq('scope', scope)
        .maybeSingle()
      const remote = data ? Number(data.best_time) : time
      await db.match_records.put({
        user_id: userId,
        scope,
        best_time: remote,
        updated_at: new Date().toISOString(),
      })
      return remote === time ? 'saved' : 'not_better'
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  const row: MatchRecordRow = {
    user_id: userId,
    scope,
    best_time: time,
    updated_at: new Date().toISOString(),
  }
  await db.match_records.put(row)
  await enqueue('match_record', 'match_record', `${userId}:${scope}`, {
    scope,
    value: time,
  })
  return 'saved'
}

export async function fetchBestScore(scope: string): Promise<number | null> {
  const db = getDb()
  const userId = await resolveUserId()
  if (!userId) return null

  const local = await db.blocks_records.get([userId, scope])
  const pending = await getPendingCount().catch(() => 0)
  if (!isReadOnline() || pending > 0) return local?.best_score ?? null

  const { data, error } = await supabase
    .from('blocks_records')
    .select('best_score')
    .eq('user_id', userId)
    .eq('scope', scope)
    .maybeSingle()

  if (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return local?.best_score ?? null
  }

  noteNetworkSuccess()
  const score = data ? Number(data.best_score) : null
  if (score !== null && (!local || score > local.best_score)) {
    await db.blocks_records.put({
      user_id: userId,
      scope,
      best_score: score,
      updated_at: new Date().toISOString(),
    })
  }
  return score ?? local?.best_score ?? null
}

export async function saveBestScore(scope: string, score: number): Promise<boolean> {
  const db = getDb()
  const userId = await resolveUserId()
  if (!userId) return false

  const local = await db.blocks_records.get([userId, scope])
  if (local && local.best_score >= score) return false

  if (isOnline()) {
    try {
      await remoteSaveBlocksRecord(scope, score)
      const { data } = await supabase
        .from('blocks_records')
        .select('best_score')
        .eq('user_id', userId)
        .eq('scope', scope)
        .maybeSingle()
      const remote = data ? Number(data.best_score) : score
      await db.blocks_records.put({
        user_id: userId,
        scope,
        best_score: remote,
        updated_at: new Date().toISOString(),
      })
      return remote <= score
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  const row: BlocksRecordRow = {
    user_id: userId,
    scope,
    best_score: score,
    updated_at: new Date().toISOString(),
  }
  await db.blocks_records.put(row)
  await enqueue('blocks_record', 'blocks_record', `${userId}:${scope}`, {
    scope,
    value: score,
  })
  return true
}

async function remoteAllFolders(userId: string): Promise<Folder[]> {
  const rows: Folder[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as Folder[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

async function remoteAllCards(userId: string): Promise<Card[]> {
  const rows: Card[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as Card[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

async function remoteAllTrainings(userId: string): Promise<GeneralTraining[]> {
  const rows: GeneralTraining[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('general_trainings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as GeneralTraining[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

async function remoteAllTrainingFolders(
  trainingIds: string[]
): Promise<GeneralTrainingFolder[]> {
  if (trainingIds.length === 0) return []
  const { data, error } = await supabase
    .from('general_training_folders')
    .select('*')
    .in('training_id', trainingIds)
  if (error) throw error
  return (data ?? []) as GeneralTrainingFolder[]
}

async function remoteAllProgress(userId: string): Promise<GeneralProgress[]> {
  const rows: GeneralProgress[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('general_progress')
      .select('*')
      .eq('user_id', userId)
      .order('training_id', { ascending: true })
      .order('word_key', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as GeneralProgress[]
    rows.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return rows
}

export async function pullSnapshot(userId: string): Promise<boolean> {
  const db = getDb()
  const pending = await getPendingCount().catch(() => 0)
  const conflicts = await db.conflicts.count()
  if (pending > 0 || conflicts > 0) return false

  try {
    const folders = await remoteAllFolders(userId)
    const cards = await remoteAllCards(userId)
    const trainings = await remoteAllTrainings(userId)
    const trainingFolders = await remoteAllTrainingFolders(trainings.map(t => t.id))
    const progress = await remoteAllProgress(userId)

    const { data: matchData, error: matchError } = await supabase
      .from('match_records')
      .select('*')
      .eq('user_id', userId)
    if (matchError) throw matchError

    const { data: blocksData, error: blocksError } = await supabase
      .from('blocks_records')
      .select('*')
      .eq('user_id', userId)
    if (blocksError) throw blocksError

    const matches = (matchData ?? []) as MatchRecordRow[]
    const blocks = (blocksData ?? []) as BlocksRecordRow[]

    await db.transaction(
      'rw',
      [
        db.folders,
        db.cards,
        db.general_trainings,
        db.general_training_folders,
        db.general_progress,
        db.match_records,
        db.blocks_records,
      ],
      async () => {
        await Promise.all([
          db.folders.clear(),
          db.cards.clear(),
          db.general_trainings.clear(),
          db.general_training_folders.clear(),
          db.general_progress.clear(),
          db.match_records.clear(),
          db.blocks_records.clear(),
        ])

        if (folders.length > 0) await db.folders.bulkPut(folders)
        if (cards.length > 0) await db.cards.bulkPut(cards)
        if (trainings.length > 0) await db.general_trainings.bulkPut(trainings)
        if (trainingFolders.length > 0) {
          await db.general_training_folders.bulkPut(trainingFolders)
        }
        if (progress.length > 0) await db.general_progress.bulkPut(progress)
        if (matches.length > 0) await db.match_records.bulkPut(matches)
        if (blocks.length > 0) await db.blocks_records.bulkPut(blocks)
      }
    )

    noteNetworkSuccess()
    markSnapshotFresh()
    await setMeta('last_sync_at', new Date().toISOString())
    return true
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return false
  }
}

export async function appendMissingCards(
  userId: string,
  folderId: string,
  cards: Card[]
): Promise<void> {
  if (!isOnline()) return
  try {
    for (const card of cards) {
      await remoteCreateCardIfMissing({ ...card, user_id: userId, folder_id: folderId })
    }
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
  }
}
