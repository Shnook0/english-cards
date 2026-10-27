import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { supabase } from '@/lib/supabase'
import { getDb } from '@/lib/offline/db'
import { resolveUserId } from '@/lib/offline/authCache'
import { isNetworkError, noteNetworkFailure } from '@/lib/offline/connectivity'
import { pullSnapshot } from '@/lib/offline/data'
import type {
  BlocksRecordRow,
  GeneralTrainingFolder,
  MatchRecordRow,
} from '@/lib/offline/db'

export type BackupData = {
  app: 'english-cards'
  version: 1
  exportedAt: string
  userId: string
  folders: Folder[]
  cards: Card[]
  general_trainings: GeneralTraining[]
  general_training_folders: GeneralTrainingFolder[]
  general_progress: GeneralProgress[]
  match_records: MatchRecordRow[]
  blocks_records: BlocksRecordRow[]
}

function stripNewCardColumns(card: Card): Record<string, unknown> {
  const next: Record<string, unknown> = { ...card }
  delete next.content_updated_at
  delete next.last_answer_at
  return next
}

export async function exportBackup(): Promise<BackupData> {
  const userId = await resolveUserId()
  if (!userId) throw new Error('Нужно войти в аккаунт')

  const db = getDb()
  const [
    folders,
    cards,
    generalTrainings,
    generalTrainingFolders,
    generalProgress,
    matchRecords,
    blocksRecords,
  ] = await Promise.all([
    db.folders.where('user_id').equals(userId).toArray(),
    db.cards.where('user_id').equals(userId).toArray(),
    db.general_trainings.where('user_id').equals(userId).toArray(),
    db.general_training_folders.toArray(),
    db.general_progress.where('user_id').equals(userId).toArray(),
    db.match_records.where('user_id').equals(userId).toArray(),
    db.blocks_records.where('user_id').equals(userId).toArray(),
  ])

  return {
    app: 'english-cards',
    version: 1,
    exportedAt: new Date().toISOString(),
    userId,
    folders,
    cards,
    general_trainings: generalTrainings,
    general_training_folders: generalTrainingFolders,
    general_progress: generalProgress,
    match_records: matchRecords,
    blocks_records: blocksRecords,
  }
}

export function downloadBackup(data: BackupData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `english-cards-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function parseBackup(text: string): BackupData {
  const parsed = JSON.parse(text) as Partial<BackupData>
  if (parsed.app !== 'english-cards' || parsed.version !== 1) {
    throw new Error('Это не файл резервной копии English Cards')
  }
  return {
    app: 'english-cards',
    version: 1,
    exportedAt: parsed.exportedAt ?? new Date().toISOString(),
    userId: parsed.userId ?? '',
    folders: parsed.folders ?? [],
    cards: parsed.cards ?? [],
    general_trainings: parsed.general_trainings ?? [],
    general_training_folders: parsed.general_training_folders ?? [],
    general_progress: parsed.general_progress ?? [],
    match_records: parsed.match_records ?? [],
    blocks_records: parsed.blocks_records ?? [],
  }
}

async function upsertChunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string
): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200)
    const { error } = await supabase
      .from(table)
      .upsert(chunk, onConflict ? { onConflict } : undefined)
    if (error) throw error
  }
}

export async function restoreBackup(text: string): Promise<void> {
  const userId = await resolveUserId()
  if (!userId) throw new Error('Нужно войти в аккаунт')

  const data = parseBackup(text)
  if (data.userId && data.userId !== userId) {
    throw new Error('Резервная копия сделана в другом аккаунте')
  }

  const hasForeignRows = [
    ...data.folders,
    ...data.cards,
    ...data.general_trainings,
    ...data.general_progress,
    ...data.match_records,
    ...data.blocks_records,
  ].some(row => 'user_id' in row && row.user_id && row.user_id !== userId)

  if (hasForeignRows) {
    throw new Error('В резервной копии есть данные другого аккаунта')
  }

  const db = getDb()

  try {
    if (data.folders.length > 0) {
      await upsertChunked('folders', data.folders as unknown as Record<string, unknown>[])
    }
    if (data.general_trainings.length > 0) {
      await upsertChunked(
        'general_trainings',
        data.general_trainings as unknown as Record<string, unknown>[]
      )
    }
    if (data.cards.length > 0) {
      try {
        await upsertChunked('cards', data.cards as unknown as Record<string, unknown>[])
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : ''
        if (code !== 'PGRST204') throw error
        await upsertChunked(
          'cards',
          data.cards.map(card => stripNewCardColumns(card))
        )
      }
    }
    if (data.general_training_folders.length > 0) {
      await upsertChunked(
        'general_training_folders',
        data.general_training_folders as unknown as Record<string, unknown>[],
        'training_id,folder_id'
      )
    }
    if (data.general_progress.length > 0) {
      await upsertChunked(
        'general_progress',
        data.general_progress as unknown as Record<string, unknown>[],
        'training_id,word_key'
      )
    }
    if (data.match_records.length > 0) {
      await upsertChunked(
        'match_records',
        data.match_records as unknown as Record<string, unknown>[],
        'user_id,scope'
      )
    }
    if (data.blocks_records.length > 0) {
      await upsertChunked(
        'blocks_records',
        data.blocks_records as unknown as Record<string, unknown>[],
        'user_id,scope'
      )
    }
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    throw new Error('Не удалось восстановить копию. Проверьте интернет и попробуйте снова.')
  }

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
      ])

      if (data.folders.length > 0) await db.folders.bulkPut(data.folders)
      if (data.cards.length > 0) await db.cards.bulkPut(data.cards)
      if (data.general_trainings.length > 0) {
        await db.general_trainings.bulkPut(data.general_trainings)
      }
      if (data.general_training_folders.length > 0) {
        await db.general_training_folders.bulkPut(data.general_training_folders)
      }
      if (data.general_progress.length > 0) {
        await db.general_progress.bulkPut(data.general_progress)
      }
      if (data.match_records.length > 0) {
        await db.match_records.bulkPut(data.match_records)
      }
      if (data.blocks_records.length > 0) {
        await db.blocks_records.bulkPut(data.blocks_records)
      }
    }
  )

  await pullSnapshot(userId)
}
