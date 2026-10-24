/** Recover known document error codes preserved in the SDK's FAILED message.
 * Never display arbitrary provider messages or document content in the bar. */
export function toolFailureFeedback(result: { code?: string; message?: string }): string {
  const code = result.code === 'FAILED' ? /^(INVALID|STALE|TARGET|UNAVAILABLE|COMPOSING|DUPLICATE|INTERRUPTED):/.exec(result.message ?? '')?.[1] : result.code;
  switch (code) {
    case 'INVALID': {
      const field = /^INVALID: ([A-Za-z][A-Za-z0-9_.\[\]]{0,100}):/.exec(result.message ?? '')?.[1];
      return `The assistant sent invalid edit parameters${field ? ` (${field})` : ''}. Ask it to correct the request. (INVALID)`;
    }
    case 'STALE': return 'The document changed before this edit. Ask the assistant to read it again and retry. (STALE)';
    case 'TARGET': return 'The requested location could not be edited. Ask the assistant to read the document and choose a valid location. (TARGET)';
    case 'COMPOSING': return 'Finish typing, then ask the assistant to retry. (COMPOSING)';
    case 'UNAVAILABLE': return 'This edit is unavailable in the current document state. (UNAVAILABLE)';
    case 'DUPLICATE': return 'This request ID was already used. Check the document before asking for another edit. (DUPLICATE)';
    case 'INTERRUPTED': return 'This action was interrupted. You can keep speaking. (INTERRUPTED)';
    default: return 'Couldn’t complete that action. Please try again. (FAILED)';
  }
}
