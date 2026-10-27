import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'

export type OutboxOp =
  | 'folder_create'
  | 'folder_delete'
  | 'card_create'
  | 'card_update'
  | 'card_delete'
  | 'card_delete_group'
  | 'card_favorite'
  | 'card_wrong_reset'
  | 'card_answer'
  | 'general_create'
  | 'general_delete'
  | 'general_answer'
  | 'match_record'
  | 'blocks_record'

export type OutboxEntity =
  | 'folder'
  | 'card'
  | 'training'
  | 'progress'
  | 'match_record'
  | 'blocks_record'

export type OutboxItem = {
  seq?: number
  id: string
  op: OutboxOp
  entity: OutboxEntity
  entityId: string
  payload: Record<string, unknown>
  baseContentUpdatedAt?: string | null
  createdAt: string
  attempts: number
  lastError?: string | null
  status: 'pending' | 'failed'
}

export type CardCreatePayload = {
  card: Card
}

export type CardUpdatePayload = {
  patch: Partial<Card>
}

export type FolderCreatePayload = {
  folder: Folder
}

export type GeneralCreatePayload = {
  training: GeneralTraining
  folderIds: string[]
}

export type CardAnswerPayload = {
  eventId: string
  cardId: string
  correct: boolean
  isLevel: boolean
  answeredAt: string
}

export type GeneralAnswerPayload = {
  eventId: string
  trainingId: string
  wordKey: string
  correct: boolean
  answeredAt: string
}

export type RecordPayload = {
  scope: string
  value: number
}

export type ConflictItem = {
  id?: number
  entity: 'card'
  entityId: string
  local: Partial<Card>
  remote: Card
  baseContentUpdatedAt?: string | null
  createdAt: string
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

export type SyncState = {
  status: SyncStatus
  online: boolean
  pending: number
  conflicts: number
  lastSyncAt: string | null
  error: string | null
}

export type CachedUser = {
  id: string
  email: string | null
}

export type GeneralProgressMap = Record<string, GeneralProgress>
