import { getChatGPTUser } from '@/app/chatgpt-auth';
import { handleVoiceSessionRequest } from '@/lib/composition/voice-sessions';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleVoiceSessionRequest(request, 'end', (await context.params).id, getChatGPTUser);
}
