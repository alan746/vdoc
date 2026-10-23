import { env } from 'cloudflare:workers';
import { getRequestUser } from './auth';
import { handleLibraryRequest } from '../infrastructure/cloud-library/http';
import { withLibraryDatabase } from '../infrastructure/cloud-library/connection';

export function cloudLibraryRequest(request: Request, id?: string, versions = false) {
  return handleLibraryRequest(request, {
    getUser: () => getRequestUser(request),
    database: (owner, write, work) => withLibraryDatabase(env.DATABASE_URL, owner, write, work),
  }, id, versions);
}
