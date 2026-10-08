import { supabase } from '@/lib/supabase'

export function formatTime(s: number): string {
  return s.toFixed(1).replace('.', ',')
}

export async function fetchBestTime(scope: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('match_records')
    .select('best_time')
    .eq('scope', scope)
    .maybeSingle()
  if (error || !data) return null
  return Number(data.best_time)
}

// Сохраняет время, только если оно лучше текущего рекорда
export async function saveBestTime(
  scope: string,
  time: number
): Promise<'saved' | 'not_better' | 'error'> {
  const { data: current, error: readErr } = await supabase
    .from('match_records')
    .select('best_time')
    .eq('scope', scope)
    .maybeSingle()
  if (readErr) return 'error'
  if (current && Number(current.best_time) <= time) return 'not_better'

  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) return 'error'

  const { error } = await supabase.from('match_records').upsert(
    {
      user_id: userId,
      scope,
      best_time: time,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,scope' }
  )
  return error ? 'error' : 'saved'
}