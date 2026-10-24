import { expect, it } from 'vitest';
import { toolFailureFeedback } from '../components/editor/realtime/tool-failure-feedback';
import { ARTICLE_VALIDATION_MESSAGES } from '../lib/domain/entities/structured-article';

it.each(Object.values(ARTICLE_VALIDATION_MESSAGES))('shows the fixed article validation reason: %s', reason => {
  const message = `INVALID: blocks[0]: ${reason} This call did NOT apply an edit.`;
  expect(toolFailureFeedback({ code: 'FAILED', message })).toContain(`(blocks[0]): ${reason}`);
});
it('keeps arbitrary provider and document content out of the error bar', () => {
  const secret = 'private document text';
  expect(toolFailureFeedback({ code: 'FAILED', message: `INVALID: blocks[0]: ${secret}` })).not.toContain(secret);
  expect(toolFailureFeedback({ code: 'FAILED', message: `INVALID: blocks[0]: ${ARTICLE_VALIDATION_MESSAGES.totalLength} ${secret}` })).not.toContain(secret);
  expect(toolFailureFeedback({ code: 'FAILED', message: secret })).not.toContain(secret);
});
