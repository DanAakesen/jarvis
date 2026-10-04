import { ConfigurationError } from '../config.js';

export function loadTaskEventArchiveStorageAccount(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const account = env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
  if (account === undefined) return undefined;
  if (!/^[a-z0-9]{3,24}$/.test(account)) {
    throw new ConfigurationError('TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT must be a valid storage account name');
  }
  return account;
}
