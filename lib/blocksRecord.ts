import { supabase } from '@/lib/supabase'

export async function fetchBestScore(scope: string): Promise<number> {
  const { data, error } = await supabase
    .from('blocks_records')
    .select('best_score')
    .eq('scope', scope)
    .maybeSingle()
  if (error || !data) return 0
  return Number(data.best_score)
}

// Сохраняет очки, только если они больше текущего рекорда
export async function saveBestScore(scope: string, score: number): Promise<boolean> {
  const { data: current, error: readErr } = await supabase
    .from('blocks_records')
    .select('best_score')
    .eq('scope', scope)
    .maybeSingle()
  if (readErr) return false
  if (current && Number(current.best_score) >= score) return true

  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return false

  const { error } = await supabase.from('blocks_records').upsert(
    {
      user_id: userId,
      scope,
      best_score: score,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,scope' }
  )
  return !error
}

