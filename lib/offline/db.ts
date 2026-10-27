import Dexie, { type Table } from 'dexie'
import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { ConflictItem, OutboxItem } from '@/types/offline'
import { clearSnapshotMark } from '@/lib/offline/connectivity'

export type GeneralTrainingFolder = {
  training_id: string
  folder_id: string
}

export type MatchRecordRow = {
  user_id: string
  scope: string
  best_time: number
  updated_at: string
}

export type BlocksRecordRow = {
  user_id: string
  scope: string
  best_score: number
  updated_at: string
}

export type MetaRow = {
  key: string
  value: unknown
}

export type TranslationCacheRow = {
  word: string
  translations: string[]
  updatedAt: string
}

export class AppDatabase extends Dexie {
  folders!: Table<Folder, string>
  cards!: Table<Card, string>
  general_trainings!: Table<GeneralTraining, string>
  general_training_folders!: Table<GeneralTrainingFolder, [string, string]>
  general_progress!: Table<GeneralProgress, [string, string]>
  match_records!: Table<MatchRecordRow, [string, string]>
  blocks_records!: Table<BlocksRecordRow, [string, string]>
  outbox!: Table<OutboxItem, number>
  conflicts!: Table<ConflictItem, number>
  meta!: Table<MetaRow, string>
  translation_cache!: Table<TranslationCacheRow, string>

  constructor() {
    super('english-cards')
    this.version(1).stores({
      folders: 'id, user_id, type, created_at',
      cards:
        'id, user_id, folder_id, is_favorite, wrong_count, learned_at, created_at, sync_group_id, content_updated_at, last_answer_at',
      general_trainings: 'id, user_id, created_at',
      general_training_folders: '[training_id+folder_id], training_id, folder_id',
      general_progress: '[training_id+word_key], training_id, word_key, updated_at',
      match_records: '[user_id+scope], user_id, scope',
      blocks_records: '[user_id+scope], user_id, scope',
      outbox: '++seq, id, op, entity, entityId, status, createdAt',
      conflicts: '++id, entity, entityId, createdAt',
      meta: 'key',
      translation_cache: 'word, updatedAt',
    })
  }
}

let instance: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB доступен только в браузере')
  }
  if (!instance) instance = new AppDatabase()
  return instance
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await getDb().meta.get(key)
  return row ? (row.value as T) : null
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await getDb().meta.put({ key, value })
}

export async function deleteMeta(key: string): Promise<void> {
  await getDb().meta.delete(key)
}

export async function clearLocalData(): Promise<void> {
  clearSnapshotMark()
  const db = getDb()
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
      db.outbox,
      db.conflicts,
      db.meta,
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
        db.outbox.clear(),
        db.conflicts.clear(),
        db.meta.clear(),
      ])
    }
  )
}
