import { handleVoiceSessionRequest } from '@/lib/composition/voice-sessions';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleVoiceSessionRequest(request, 'grant', (await context.params).id);
}
