export type GeneralTraining = {
  id: string
  user_id: string
  name: string
  scope: 'all' | 'custom'
  created_at: string
}

export type GeneralProgress = {
  training_id: string
  word_key: string
  user_id: string
  level: number
  next_review_at: string
  mistake_until: string | null
  mistake_streak: number
  wrong_total: number
  updated_at: string
}