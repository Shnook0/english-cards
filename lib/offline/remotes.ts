import { Card, Folder } from '@/types/database'
import { GeneralProgress, GeneralTraining } from '@/types/general'
import { supabase } from '@/lib/supabase'
import { isNetworkError, noteNetworkFailure, noteNetworkSuccess } from '@/lib/offline/connectivity'

export type CardConflictResult =
  | { status: 'ok'; card: Card }
  | { status: 'conflict'; remote: Card }
  | { status: 'missing' }

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '')
  }
  return ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '')
  }
  return ''
}

export function isMissingColumn(error: unknown): boolean {
  return (
    errorCode(error) === 'PGRST204' ||
    /could not find the '.*' column|column .* does not exist|schema cache/i.test(
      errorMessage(error)
    )
  )
}

export function isMissingRpc(error: unknown): boolean {
  return (
    errorCode(error) === 'PGRST202' ||
    /could not find the function|function .* does not exist|schema cache/i.test(
      errorMessage(error)
    )
  )
}

export function isDuplicate(error: unknown): boolean {
  return errorCode(error) === '23505' || /duplicate key/i.test(errorMessage(error))
}

function rethrowNetwork(error: unknown): void {
  if (isNetworkError(error)) {
    noteNetworkFailure()
    throw error
  }
}

function stripNewCardColumns(card: Record<string, unknown>): Record<string, unknown> {
  const next = { ...card }
  delete next.content_updated_at
  delete next.last_answer_at
  return next
}

export async function remoteCreateFolder(folder: Folder): Promise<void> {
  const { error } = await supabase.from('folders').insert(folder)
  if (!error || isDuplicate(error)) {
    noteNetworkSuccess()
    return
  }
  rethrowNetwork(error)
  throw error
}

export async function remoteDeleteFolder(folderId: string): Promise<void> {
  const { error } = await supabase.from('folders').delete().eq('id', folderId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

export async function remoteGetCard(cardId: string): Promise<Card | null> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle()
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
  return (data as Card | null) ?? null
}

export async function remoteCreateCardIfMissing(card: Card): Promise<Card> {
  const existing = await remoteGetCard(card.id)
  if (existing) return existing

  let { data, error } = await supabase
    .from('cards')
    .insert(card)
    .select('*')
    .single()

  if (error && isMissingColumn(error)) {
    const retry = await supabase
      .from('cards')
      .insert(stripNewCardColumns(card as unknown as Record<string, unknown>))
      .select('*')
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) {
    if (isDuplicate(error)) {
      const row = await remoteGetCard(card.id)
      if (row) return row
    }
    rethrowNetwork(error)
    throw error
  }

  noteNetworkSuccess()
  return data as Card
}

export async function remoteDeleteCard(cardId: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('id', cardId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

export async function remoteDeleteCardGroup(syncGroupId: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('sync_group_id', syncGroupId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

export async function remoteSetFavorite(cardId: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('cards')
    .update({ is_favorite: value })
    .eq('id', cardId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

export async function remoteResetWrong(cardId: string): Promise<void> {
  const { error } = await supabase.from('cards').update({ wrong_count: 0 }).eq('id', cardId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

function contentMatches(card: Card, patch: Partial<Card>): boolean {
  return (
    (patch.word === undefined || patch.word === card.word) &&
    (patch.transcription === undefined || (patch.transcription ?? null) === (card.transcription ?? null)) &&
    (patch.translation === undefined || patch.translation === card.translation) &&
    (patch.sentences === undefined ||
      JSON.stringify(patch.sentences ?? []) === JSON.stringify(card.sentences ?? [])) &&
    (patch.folder_id === undefined || patch.folder_id === card.folder_id)
  )
}

export async function remoteUpdateCardContent(
  cardId: string,
  patch: Partial<Card>,
  baseContentUpdatedAt?: string | null
): Promise<CardConflictResult> {
  let query = supabase.from('cards').update(patch).eq('id', cardId)
  if (baseContentUpdatedAt) {
    query = query.eq('content_updated_at', baseContentUpdatedAt)
  }

  let { data, error } = await query.select('*').maybeSingle()

  if (error && isMissingColumn(error) && baseContentUpdatedAt) {
    const retry = await supabase.from('cards').update(patch).eq('id', cardId).select('*').maybeSingle()
    data = retry.data
    error = retry.error
  }

  if (error) {
    rethrowNetwork(error)
    throw error
  }

  noteNetworkSuccess()

  if (data) return { status: 'ok', card: data as Card }

  const remote = await remoteGetCard(cardId)
  if (!remote) return { status: 'missing' }
  if (contentMatches(remote, patch)) return { status: 'ok', card: remote }
  return { status: 'conflict', remote }
}

export type CardAnswerEvent = {
  eventId: string
  cardId: string
  correct: boolean
  isLevel: boolean
  answeredAt: string
  patch: Partial<Card>
}

export async function remoteApplyCardAnswer(event: CardAnswerEvent): Promise<Card | null> {
  const { data, error } = await supabase.rpc('apply_card_answer', {
    p_event_id: event.eventId,
    p_card_id: event.cardId,
    p_correct: event.correct,
    p_is_level: event.isLevel,
    p_answered_at: event.answeredAt,
  })

  if (!error) {
    noteNetworkSuccess()
    const row = Array.isArray(data) ? (data[0] as Card | undefined) : (data as Card | null)
    return row ?? (await remoteGetCard(event.cardId))
  }

  if (isMissingRpc(error)) {
    let { data: row, error: updateError } = await supabase
      .from('cards')
      .update(event.patch)
      .eq('id', event.cardId)
      .select('*')
      .maybeSingle()

    if (updateError && isMissingColumn(updateError)) {
      const retry = await supabase
        .from('cards')
        .update(stripNewCardColumns(event.patch as unknown as Record<string, unknown>))
        .eq('id', event.cardId)
        .select('*')
        .maybeSingle()
      row = retry.data
      updateError = retry.error
    }

    if (updateError) {
      rethrowNetwork(updateError)
      throw updateError
    }

    noteNetworkSuccess()
    return (row as Card | null) ?? null
  }

  rethrowNetwork(error)
  throw error
}

export async function remoteCreateTraining(
  training: GeneralTraining,
  folderIds: string[]
): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from('general_trainings')
    .select('id')
    .eq('id', training.id)
    .maybeSingle()
  if (readError) {
    rethrowNetwork(readError)
    throw readError
  }

  if (!existing) {
    const { error } = await supabase.from('general_trainings').insert(training)
    if (error && !isDuplicate(error)) {
      rethrowNetwork(error)
      throw error
    }
  }

  if (training.scope === 'custom') {
    const { error: deleteError } = await supabase
      .from('general_training_folders')
      .delete()
      .eq('training_id', training.id)
    if (deleteError) {
      rethrowNetwork(deleteError)
      throw deleteError
    }

    if (folderIds.length > 0) {
      const rows = folderIds.map(folderId => ({
        training_id: training.id,
        folder_id: folderId,
      }))
      const { error } = await supabase.from('general_training_folders').insert(rows)
      if (error) {
        rethrowNetwork(error)
        throw error
      }
    }
  }

  noteNetworkSuccess()
}

export async function remoteDeleteTraining(trainingId: string): Promise<void> {
  const { error } = await supabase.from('general_trainings').delete().eq('id', trainingId)
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
}

export async function remoteUpsertGeneralProgress(row: GeneralProgress): Promise<GeneralProgress> {
  const { data, error } = await supabase
    .from('general_progress')
    .upsert(row, { onConflict: 'training_id,word_key' })
    .select('*')
    .single()
  if (error) {
    rethrowNetwork(error)
    throw error
  }
  noteNetworkSuccess()
  return (data as GeneralProgress) ?? row
}

export type GeneralAnswerEvent = {
  eventId: string
  trainingId: string
  wordKey: string
  correct: boolean
  answeredAt: string
  fallback: GeneralProgress
}

export async function remoteApplyGeneralAnswer(
  event: GeneralAnswerEvent
): Promise<GeneralProgress | null> {
  const { data, error } = await supabase.rpc('apply_general_answer', {
    p_event_id: event.eventId,
    p_training_id: event.trainingId,
    p_word_key: event.wordKey,
    p_correct: event.correct,
    p_answered_at: event.answeredAt,
  })

  if (!error) {
    noteNetworkSuccess()
    const row = Array.isArray(data) ? (data[0] as GeneralProgress | undefined) : (data as GeneralProgress | null)
    return row ?? event.fallback
  }

  if (isMissingRpc(error)) {
    return remoteUpsertGeneralProgress(event.fallback)
  }

  rethrowNetwork(error)
  throw error
}

export async function remoteSaveMatchRecord(scope: string, time: number): Promise<void> {
  const { error } = await supabase.rpc('save_match_record', {
    p_scope: scope,
    p_time: time,
  })
  if (!error) {
    noteNetworkSuccess()
    return
  }

  if (isMissingRpc(error)) {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) throw new Error('not authenticated')

    const { data: current, error: readError } = await supabase
      .from('match_records')
      .select('best_time')
      .eq('user_id', userId)
      .eq('scope', scope)
      .maybeSingle()
    if (readError) {
      rethrowNetwork(readError)
      throw readError
    }
    if (current && Number(current.best_time) <= time) return

    const { error: upsertError } = await supabase.from('match_records').upsert(
      {
        user_id: userId,
        scope,
        best_time: time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,scope' }
    )
    if (upsertError) {
      rethrowNetwork(upsertError)
      throw upsertError
    }
    noteNetworkSuccess()
    return
  }

  rethrowNetwork(error)
  throw error
}

export async function remoteSaveBlocksRecord(scope: string, score: number): Promise<void> {
  const { error } = await supabase.rpc('save_blocks_record', {
    p_scope: scope,
    p_score: score,
  })
  if (!error) {
    noteNetworkSuccess()
    return
  }

  if (isMissingRpc(error)) {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) throw new Error('not authenticated')

    const { data: current, error: readError } = await supabase
      .from('blocks_records')
      .select('best_score')
      .eq('user_id', userId)
      .eq('scope', scope)
      .maybeSingle()
    if (readError) {
      rethrowNetwork(readError)
      throw readError
    }
    if (current && Number(current.best_score) >= score) return

    const { error: upsertError } = await supabase.from('blocks_records').upsert(
      {
        user_id: userId,
        scope,
        best_score: score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,scope' }
    )
    if (upsertError) {
      rethrowNetwork(upsertError)
      throw upsertError
    }
    noteNetworkSuccess()
    return
  }

  rethrowNetwork(error)
  throw error
}
