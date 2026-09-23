import { apiPostJson } from './client'

export type ForceBackupResult = { overwritten: boolean; backup_path?: string }

/** Snapshot the DB now, replacing today's backup if one exists. */
export const forceBackupToday = () => apiPostJson<ForceBackupResult>('/api/backups/force-today', {})
