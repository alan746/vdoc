import { cloudLibraryRequest } from '@/lib/composition/cloud-library';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return cloudLibraryRequest(request, (await context.params).id, true);
}
