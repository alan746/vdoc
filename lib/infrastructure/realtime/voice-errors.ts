/** Only application-owned messages reach the UI; upstream bodies may contain secrets. */
export class VoiceConnectionError extends Error {}

export async function voiceRequestError(response: Response): Promise<VoiceConnectionError> {
  const data = await response.json().catch(() => null) as { error?: { code?: string; quotaKind?: string; retryAfterSeconds?: number } } | null;
  const code = data?.error?.code;
  const seconds = data?.error?.retryAfterSeconds;
  const retry = typeof seconds === 'number' && Number.isSafeInteger(seconds) && seconds > 0 ? ` Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.` : '';
  if (response.status === 503 && code === 'QUOTA_UNAVAILABLE') return new VoiceConnectionError('Voice limits could not be checked. Try again later.' + retry);
  if (response.status === 429 && code === 'QUOTA_EXCEEDED') {
    const kind = data?.error?.quotaKind;
    const message = kind === 'concurrency'
      ? 'Too many voice sessions are open for your account. Disconnect another session, then retry.'
      : kind === 'rate' ? 'Your account has reached its hourly voice session limit. Wait before starting another session.'
        : 'Your account has reached a voice session limit. Wait before retrying.';
    return new VoiceConnectionError(message + retry);
  }
  const messages: Record<string, string> = {
    VOICE_NOT_CONFIGURED: 'Voice is not available on this site yet. Contact the site administrator.',
    AUTH_UNAVAILABLE: 'Sign-in is temporarily unavailable. Try again later.',
    STORAGE_UNAVAILABLE: 'Cloud document access could not be checked. Reconnect and retry.',
  };
  const statuses: Record<number, string> = {
    401: 'Sign in again, then reopen your cloud document to use the assistant.',
    402: 'Voice quota is exhausted. Contact the site administrator about your allowance.',
    403: 'Voice requires a cloud document owned by your signed-in account and outside Trash. Open it in the cloud workspace.',
    404: 'This voice session is no longer available. Connect again.',
    409: 'The voice session cannot start or resume right now. Disconnect other sessions and retry.',
    429: 'Voice quota or request limit reached. Wait before retrying, or contact the site administrator about your allowance.',
    503: 'The voice service is temporarily unavailable. Try again later.',
  };
  return new VoiceConnectionError((code && messages[code]) || statuses[response.status] || 'Could not reach the voice service. Check your connection and retry.');
}

export function microphoneError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. Allow microphone access in your browser’s site settings, then retry.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable microphone was found. Connect a microphone, then retry.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone could not start. Check whether another app is using it, then retry.';
  return 'Audio could not start. Check your microphone and browser audio settings, then retry.';
}
