import { CloudRepositories } from '../infrastructure/cloud-sync/repositories';
import { configureCloudRepositories } from './repositories';
export type { SyncState } from '../infrastructure/cloud-sync/repositories';

export function createCloudWorkspace(owner: string) {
  const repositories = new CloudRepositories(owner);
  configureCloudRepositories(owner, repositories);
  return repositories;
}
