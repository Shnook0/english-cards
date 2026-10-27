import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { OutboxItem, SyncState } from '@/types/offline'
import { getDb, getMeta } from '@/lib/offline/db'
import {
  completeOutboxItem,
  failOutboxItem,
  getFailedCount,
  getOutbox,
  getPendingCount,
  markOutboxFailed,
} from '@/lib/offline/outbox'
import { isNetworkError, isOnline, noteNetworkFailure } from '@/lib/offline/connectivity'
import { recordConflict } from '@/lib/offline/conflicts'
import { pullSnapshot } from '@/lib/offline/data'
import {
  remoteApplyCardAnswer,
  remoteApplyGeneralAnswer,
  remoteCreateCardIfMissing,
  remoteCreateFolder,
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

export type SyncResult = {
  ok: boolean
  pending: number
  failed: number
  conflicts: number
  pulled: boolean
  error?: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }
  return 'Неизвестная ошибка'
}

async function applyOutboxItem(item: OutboxItem): Promise<'ok' | 'conflict'> {
  const db = getDb()
  const payload = item.payload

  switch (item.op) {
    case 'folder_create': {
      await remoteCreateFolder(payload.folder as Folder)
      return 'ok'
    }
    case 'folder_delete': {
      await remoteDeleteFolder(item.entityId)
      return 'ok'
    }
    case 'card_create': {
      const card = await remoteCreateCardIfMissing(payload.card as Card)
      await db.cards.put(card)
      return 'ok'
    }
    case 'card_update': {
      const patch = (payload.patch ?? {}) as Partial<Card>
      const result = await remoteUpdateCardContent(
        item.entityId,
        patch,
        item.baseContentUpdatedAt ?? null
      )
      if (result.status === 'ok') {
        await db.cards.put(result.card)
        return 'ok'
      }
      if (result.status === 'conflict') {
        await recordConflict(
          item.entityId,
          patch,
          result.remote,
          item.baseContentUpdatedAt ?? null
        )
        return 'conflict'
      }
      await db.cards.delete(item.entityId)
      return 'ok'
    }
    case 'card_delete': {
      await remoteDeleteCard(item.entityId)
      return 'ok'
    }
    case 'card_delete_group': {
      await remoteDeleteCardGroup(item.entityId)
      return 'ok'
    }
    case 'card_favorite': {
      await remoteSetFavorite(item.entityId, Boolean(payload.value))
      return 'ok'
    }
    case 'card_wrong_reset': {
      await remoteResetWrong(item.entityId)
      return 'ok'
    }
    case 'card_answer': {
      const row = await remoteApplyCardAnswer({
        eventId: String(payload.eventId),
        cardId: item.entityId,
        correct: Boolean(payload.correct),
        isLevel: Boolean(payload.isLevel),
        answeredAt: String(payload.answeredAt),
        patch: (payload.patch ?? {}) as Partial<Card>,
      })
      if (row) await db.cards.put(row)
      return 'ok'
    }
    case 'general_create': {
      const training = payload.training as GeneralTraining
      const folderIds = (payload.folderIds ?? []) as string[]
      await remoteCreateTraining(training, folderIds)
      return 'ok'
    }
    case 'general_delete': {
      await remoteDeleteTraining(item.entityId)
      return 'ok'
    }
    case 'general_answer': {
      const trainingId = String(payload.trainingId)
      const wordKey = String(payload.wordKey)
      const row = await remoteApplyGeneralAnswer({
        eventId: String(payload.eventId),
        trainingId,
        wordKey,
        correct: Boolean(payload.correct),
        answeredAt: String(payload.answeredAt),
        fallback: payload.fallback as GeneralProgress,
      })
      if (row) await db.general_progress.put(row)
      return 'ok'
    }
    case 'match_record': {
      await remoteSaveMatchRecord(String(payload.scope), Number(payload.value))
      return 'ok'
    }
    case 'blocks_record': {
      await remoteSaveBlocksRecord(String(payload.scope), Number(payload.value))
      return 'ok'
    }
    default:
      return 'ok'
  }
}

async function pushOutbox(): Promise<SyncResult> {
  const items = await getOutbox()
  let conflicts = 0

  for (const item of items) {
    if (item.seq === undefined) continue
    if (item.status === 'failed') continue
    if (!isOnline()) break

    try {
      const result = await applyOutboxItem(item)
      if (result === 'conflict') conflicts += 1
      await completeOutboxItem(item.seq)
    } catch (error) {
      if (isNetworkError(error)) noteNetworkFailure()

      const message = messageOf(error)
      if (!isNetworkError(error) && item.attempts + 1 >= 3) {
        await markOutboxFailed(item.seq, message)
      } else {
        await failOutboxItem(item.seq, message)
      }

      return {
        ok: false,
        pending: await getPendingCount(),
        failed: await getFailedCount(),
        conflicts,
        pulled: false,
        error: message,
      }
    }
  }

  return {
    ok: true,
    pending: await getPendingCount(),
    failed: await getFailedCount(),
    conflicts,
    pulled: false,
  }
}

const running = new Map<string, Promise<SyncResult>>()

async function runSync(userId: string): Promise<SyncResult> {
  if (!isOnline()) {
    return {
      ok: false,
      pending: await getPendingCount(),
      failed: await getFailedCount(),
      conflicts: await getDb().conflicts.count(),
      pulled: false,
      error: 'Нет подключения к интернету',
    }
  }

  const pushed = await pushOutbox()
  if (!pushed.ok) return pushed

  let pulled = false
  if (pushed.pending === 0 && pushed.failed === 0) {
    pulled = await pullSnapshot(userId)
  }

  const failed = await getFailedCount()
  const conflicts = await getDb().conflicts.count()

  return {
    ok: failed === 0 && pushed.ok,
    pending: await getPendingCount(),
    failed,
    conflicts,
    pulled,
    error: pushed.error,
  }
}

export function syncNow(userId: string): Promise<SyncResult> {
  const current = running.get(userId)
  if (current) return current

  const task = runSync(userId).finally(() => {
    running.delete(userId)
  })
  running.set(userId, task)
  return task
}

export async function getSyncState(): Promise<SyncState> {
  const db = getDb()
  const [pending, failed, conflicts, lastSyncAt] = await Promise.all([
    getPendingCount(),
    getFailedCount(),
    db.conflicts.count(),
    getMeta<string>('last_sync_at'),
  ])

  const online = isOnline()
  let status: SyncState['status'] = 'idle'
  if (!online) status = 'offline'
  else if (failed > 0) status = 'error'

  return {
    status,
    online,
    pending,
    conflicts,
    lastSyncAt: lastSyncAt ?? null,
    error: failed > 0 ? `Не удалось отправить операций: ${failed}` : null,
  }
}
