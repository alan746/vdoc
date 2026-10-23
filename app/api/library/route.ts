import { cloudLibraryRequest } from '@/lib/composition/cloud-library';
export const GET = (request: Request) => cloudLibraryRequest(request);
export const POST = GET;
