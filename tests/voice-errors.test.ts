import { expect, it } from 'vitest';
import { voiceRequestError } from '../lib/infrastructure/realtime/voice-errors';

it.each([
  ['concurrency', /Disconnect another session/],
  ['rate', /hourly voice session limit/],
] as const)('explains the %s quota and safe retry interval without backend detail', async (quotaKind, message) => {
  const error = await voiceRequestError(Response.json({ error: { code: 'QUOTA_EXCEEDED', quotaKind, retryAfterSeconds: 45, message: 'private API credential' } }, { status: 429 }));
  expect(error.message).toMatch(message);
  expect(error.message).toContain('45 seconds');
  expect(error.message).not.toContain('credential');
});
it('distinguishes a quota storage outage from account exhaustion', async () => {
  const error = await voiceRequestError(Response.json({ error: { code: 'QUOTA_UNAVAILABLE', message: 'postgres://private', retryAfterSeconds: 1 } }, { status: 503 }));
  expect(error.message).toContain('could not be checked');
  expect(error.message).toContain('1 second');
  expect(error.message).not.toContain('postgres:');
});
it.each([0, -1, 0.5, '30', null, Number.MAX_SAFE_INTEGER + 1])('does not render invalid retry intervals: %j', async retryAfterSeconds => {
  const error = await voiceRequestError(Response.json({ error: { code: 'QUOTA_EXCEEDED', quotaKind: 'unknown', retryAfterSeconds } }, { status: 429 }));
  expect(error.message).toContain('voice session limit');
  expect(error.message).not.toContain('seconds');
});
it('does not treat unrelated status codes as account exhaustion', async () => {
  const error = await voiceRequestError(Response.json({ error: { code: 'QUOTA_EXCEEDED', quotaKind: 'rate', retryAfterSeconds: 60 } }, { status: 502 }));
  expect(error.message).not.toContain('hourly');
});
