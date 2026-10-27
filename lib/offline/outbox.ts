import { Card } from '@/types/database'
import { OutboxEntity, OutboxItem, OutboxOp } from '@/types/offline'
import { getDb } from '@/lib/offline/db'
import { newId } from '@/lib/offline/connectivity'

const OUTBOX_EVENT = 'english-cards:outbox'

export function notifyOutboxChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OUTBOX_EVENT))
  }
}

export function subscribeOutbox(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(OUTBOX_EVENT, listener)
  return () => window.removeEventListener(OUTBOX_EVENT, listener)
}

export async function getOutbox(): Promise<OutboxItem[]> {
  return getDb().outbox.orderBy('seq').toArray()
}

export async function getPendingCount(): Promise<number> {
  return getDb().outbox.where('status').equals('pending').count()
}

export async function getFailedCount(): Promise<number> {
  return getDb().outbox.where('status').equals('failed').count()
}

function changesWithoutSeq(item: OutboxItem): Omit<OutboxItem, 'seq'> {
  const next = { ...item }
  delete next.seq
  return next
}

function isSameCard(item: OutboxItem, cardId: string): boolean {
  return item.entity === 'card' && item.entityId === cardId
}

function patchCreateCard(item: OutboxItem, patch: Partial<Card>): OutboxItem {
  const payload = item.payload as { card?: Card }
  if (!payload.card) return item
  return {
    ...item,
    payload: { ...payload, card: { ...payload.card, ...patch } },
  }
}

export async function enqueue(
  op: OutboxOp,
  entity: OutboxEntity,
  entityId: string,
  payload: Record<string, unknown>,
  baseContentUpdatedAt?: string | null
): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()

  await db.transaction('rw', db.outbox, async () => {
    const items = await db.outbox.where('entityId').equals(entityId).toArray()
    const pending = items.filter(item => item.status === 'pending')
    const pendingCreate = pending.find(item => item.op === 'card_create')
    const pendingUpdate = pending.find(item => item.op === 'card_update')
    const pendingFavorite = pending.find(item => item.op === 'card_favorite')

    if (op === 'card_answer' && pendingCreate && isSameCard(pendingCreate, entityId)) {
      const patch = payload.patch as Partial<Card> | undefined
      const patch2 = payload.cardPatch as Partial<Card> | undefined
      if (patch || patch2) {
        await db.outbox.update(
          pendingCreate.seq!,
          changesWithoutSeq(patchCreateCard(pendingCreate, patch ?? patch2!))
        )
      }
      return
    }

    if (op === 'card_update' && pendingCreate && isSameCard(pendingCreate, entityId)) {
      const patch = (payload.patch ?? {}) as Partial<Card>
      await db.outbox.update(
        pendingCreate.seq!,
        changesWithoutSeq(patchCreateCard(pendingCreate, patch))
      )
      return
    }

    if (op === 'card_favorite' && pendingCreate && isSameCard(pendingCreate, entityId)) {
      await db.outbox.update(
        pendingCreate.seq!,
        changesWithoutSeq(
          patchCreateCard(pendingCreate, { is_favorite: payload.value as boolean })
        )
      )
      return
    }

    if (op === 'card_wrong_reset' && pendingCreate && isSameCard(pendingCreate, entityId)) {
      await db.outbox.update(
        pendingCreate.seq!,
        changesWithoutSeq(patchCreateCard(pendingCreate, { wrong_count: 0 }))
      )
      return
    }

    if (op === 'card_favorite' && pendingFavorite) {
      await db.outbox.update(
        pendingFavorite.seq!,
        changesWithoutSeq({
          ...pendingFavorite,
          payload,
          status: 'pending',
          lastError: null,
        })
      )
      return
    }

    if (op === 'card_update' && pendingUpdate) {
      const currentPatch = (pendingUpdate.payload.patch ?? {}) as Partial<Card>
      const nextPatch = (payload.patch ?? {}) as Partial<Card>
      await db.outbox.update(
        pendingUpdate.seq!,
        changesWithoutSeq({
          ...pendingUpdate,
          payload: { ...pendingUpdate.payload, patch: { ...currentPatch, ...nextPatch } },
          status: 'pending',
          lastError: null,
        })
      )
      return
    }

    if (op === 'card_delete') {
      const removable = items.filter(
        item =>
          item.status === 'pending' &&
          ['card_create', 'card_update', 'card_answer', 'card_favorite', 'card_wrong_reset'].includes(
            item.op
          )
      )
      if (removable.some(item => item.op === 'card_create')) {
        await db.outbox.bulkDelete(removable.map(item => item.seq!))
        return
      }
      if (removable.length > 0) {
        await db.outbox.bulkDelete(removable.map(item => item.seq!))
      }
    }

    if (op === 'card_delete_group') {
      const groupId = payload.syncGroupId as string | undefined
      const cardIds = groupId
        ? (await db.cards.where('sync_group_id').equals(groupId).toArray()).map(card => card.id)
        : []
      if (cardIds.length > 0) {
        const removable = items.filter(
          item =>
            item.status === 'pending' &&
            cardIds.includes(item.entityId) &&
            item.op !== 'card_delete_group'
        )
        if (removable.length > 0) {
          await db.outbox.bulkDelete(removable.map(item => item.seq!))
        }
      }
    }

    if (op === 'folder_delete') {
      const createOp = items.find(item => item.op === 'folder_create' && item.status === 'pending')
      if (createOp) {
        const cards = await db.cards.where('folder_id').equals(entityId).toArray()
        const cardIds = cards.map(card => card.id)
        const cardItems =
          cardIds.length > 0
            ? await db.outbox.where('entityId').anyOf(cardIds).toArray()
            : []
        const seqs = [createOp.seq!, ...cardItems.map(item => item.seq!)]
        await db.outbox.bulkDelete(seqs)
        return
      }
    }

    const item: OutboxItem = {
      id: newId(),
      op,
      entity,
      entityId,
      payload,
      baseContentUpdatedAt: baseContentUpdatedAt ?? null,
      createdAt: now,
      attempts: 0,
      lastError: null,
      status: 'pending',
    }

    await db.outbox.add(item)
  })

  notifyOutboxChanged()
}

export async function completeOutboxItem(seq: number): Promise<void> {
  await getDb().outbox.delete(seq)
  notifyOutboxChanged()
}

export async function failOutboxItem(seq: number, error: string): Promise<void> {
  const item = await getDb().outbox.get(seq)
  if (!item) return
  await getDb().outbox.update(
    seq,
    changesWithoutSeq({
      ...item,
      attempts: item.attempts + 1,
      lastError: error,
      status: 'pending',
    })
  )
  notifyOutboxChanged()
}

export async function markOutboxFailed(seq: number, error: string): Promise<void> {
  const item = await getDb().outbox.get(seq)
  if (!item) return
  await getDb().outbox.update(
    seq,
    changesWithoutSeq({
      ...item,
      attempts: item.attempts + 1,
      lastError: error,
      status: 'failed',
    })
  )
  notifyOutboxChanged()
}

export async function resetOutboxItem(seq: number): Promise<void> {
  const item = await getDb().outbox.get(seq)
  if (!item) return
  await getDb().outbox.update(
    seq,
    changesWithoutSeq({ ...item, status: 'pending', lastError: null })
  )
}

export async function clearOutbox(): Promise<void> {
  await getDb().outbox.clear()
  notifyOutboxChanged()
}
