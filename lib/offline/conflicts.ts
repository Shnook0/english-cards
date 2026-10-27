import { Card } from '@/types/database'
import { ConflictItem } from '@/types/offline'
import { supabase } from '@/lib/supabase'
import { getDb } from '@/lib/offline/db'
import { isNetworkError, noteNetworkFailure, noteNetworkSuccess } from '@/lib/offline/connectivity'
import { notifyOutboxChanged } from '@/lib/offline/outbox'

export async function recordConflict(
  cardId: string,
  local: Partial<Card>,
  remote: Card,
  baseContentUpdatedAt?: string | null
): Promise<void> {
  const db = getDb()
  const existing = await db.conflicts.where('entityId').equals(cardId).first()
  const item: ConflictItem = {
    entity: 'card',
    entityId: cardId,
    local,
    remote,
    baseContentUpdatedAt: baseContentUpdatedAt ?? null,
    createdAt: new Date().toISOString(),
  }

  if (existing?.id) {
    await db.conflicts.update(existing.id, item)
  } else {
    await db.conflicts.add(item)
  }
}

export async function listConflicts(): Promise<ConflictItem[]> {
  return getDb().conflicts.orderBy('createdAt').toArray()
}

function applyConflictChoice(
  local: Partial<Card>,
  remote: Card,
  choice: 'mine' | 'server' | 'merge'
): Partial<Card> {
  if (choice === 'server') return {}

  const patch: Partial<Card> = {
    word: local.word ?? remote.word,
    transcription: local.transcription ?? remote.transcription,
    translation: local.translation ?? remote.translation,
    sentences:
      choice === 'merge'
        ? Array.from(new Set([...(remote.sentences ?? []), ...(local.sentences ?? [])]))
        : (local.sentences ?? remote.sentences),
  }

  return patch
}

export async function resolveConflict(
  id: number,
  choice: 'mine' | 'server' | 'merge'
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb()
  const conflict = await db.conflicts.get(id)
  if (!conflict) return { ok: true }

  if (choice === 'server') {
    await db.cards.put(conflict.remote)
    await db.conflicts.delete(id)
    notifyOutboxChanged()
    return { ok: true }
  }

  const patch = applyConflictChoice(conflict.local, conflict.remote, choice)

  try {
    const { data, error } = await supabase
      .from('cards')
      .update(patch)
      .eq('id', conflict.entityId)
      .select('*')
      .maybeSingle()

    if (error) {
      if (isNetworkError(error)) noteNetworkFailure()
      return { ok: false, error: 'Не удалось сохранить решение. Проверьте интернет.' }
    }

    noteNetworkSuccess()
    const resolved = (data as Card | null) ?? { ...conflict.remote, ...patch }
    await db.cards.put(resolved)
    await db.conflicts.delete(id)
    notifyOutboxChanged()
    return { ok: true }
  } catch (error) {
    if (isNetworkError(error)) noteNetworkFailure()
    return { ok: false, error: 'Не удалось сохранить решение. Проверьте интернет.' }
  }
}

export async function retryFailedOutbox(): Promise<void> {
  const db = getDb()
  const failed = await db.outbox.where('status').equals('failed').toArray()
  await Promise.all(
    failed.map(item => {
      const next = { ...item }
      delete next.seq
      return db.outbox.update(item.seq!, {
        ...next,
        status: 'pending',
        attempts: 0,
        lastError: null,
      })
    })
  )
  notifyOutboxChanged()
}
