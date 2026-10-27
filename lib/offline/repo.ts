export {
  fetchCards,
  fetchFolders,
  fetchFolder,
  createFolder,
  deleteFolder,
  createCards,
  createCard,
  updateCardContent,
  setFavorite,
  resetWrongCount,
  deleteCard,
  deleteCardsByGroup,
  saveCardAnswer,
  fetchGeneralTrainings,
  fetchTraining,
  fetchTrainingFolderIds,
  fetchGeneralTrainingFolders,
  createGeneralTraining,
  deleteGeneralTraining,
  fetchTrainingCards,
  fetchProgress,
  defaultGeneralProgress,
  computeGeneralProgress,
  saveGeneralAnswer,
  fetchBestTime,
  saveBestTime,
  fetchBestScore,
  saveBestScore,
  pullSnapshot,
} from '@/lib/offline/data'

export type { CardQuery, NewCardInput, UpdateCardResult } from '@/lib/offline/data'
export { syncNow, getSyncState } from '@/lib/offline/sync'
export type { SyncResult } from '@/lib/offline/sync'
export { exportBackup, downloadBackup, restoreBackup } from '@/lib/offline/backup'
export type { BackupData } from '@/lib/offline/backup'
export { listConflicts, resolveConflict, retryFailedOutbox } from '@/lib/offline/conflicts'
export { getPendingCount, getFailedCount, getOutbox } from '@/lib/offline/outbox'
export { isOnline, subscribeConnectivity } from '@/lib/offline/connectivity'
export { clearLocalData } from '@/lib/offline/db'
export { getCachedUser, cacheUser, clearCachedUser } from '@/lib/offline/authCache'
