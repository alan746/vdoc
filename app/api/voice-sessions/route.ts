import { handleVoiceSessionRequest } from '@/lib/composition/voice-sessions';

export async function GET(request: Request) {
  return handleVoiceSessionRequest(request, 'check', undefined);
}

export async function POST(request: Request) {
  return handleVoiceSessionRequest(request, 'create', undefined);
}
