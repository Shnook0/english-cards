export type Profile = {
  id: string
  email?: string | null
  updated_at?: string | null
  created_at: string
}

export type Folder = {
  id: string
  user_id: string
  name: string
  type: 'custom' | 'learned' | 'level'
  created_at: string
}

export type Card = {
  id: string
  user_id: string
  folder_id: string
  word: string
  transcription?: string | null
  translation: string
  sentences: string[]
  is_favorite: boolean
  known_streak: number
  wrong_count: number
  srs_level: number
  next_review_at: string
  learned_at?: string | null
  created_at: string
  sync_group_id?: string | null
  content_updated_at?: string | null
  last_answer_at?: string | null
  // «Сложные слова» папки (см. lib/hard.ts). hard_since != null — слово в списке.
  hard_since?: string | null
  hard_misses?: number | null
  hard_run?: number | null
  hard_confirmed_at?: string | null
}