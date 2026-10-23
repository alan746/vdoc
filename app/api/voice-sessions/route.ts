import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleVoiceSessionRequest } from '@/lib/composition/voice-sessions';

export async function POST(request: Request) {
  return handleVoiceSessionRequest(request, 'create', undefined, getChatGPTUser);
}
