import { expect, it } from 'vitest';
import { actionErrorMessage } from '../lib/shared/error-message';

it.each([new DOMException('', 'QuotaExceededError'),{name:'QuotaExceededError',message:''},Object.assign(new Error(''),{name:'QuotaExceededError'})])('explains native and cross-realm quota errors even without a message',error=>{
  expect(actionErrorMessage(error,'Failed.')).toBe('Local storage is full. Download a backup of any unsaved changes, free some space, then try again.');
});
it.each([new Error(''),new Error('   '),null,undefined,{},'unexpected'])('keeps a nonempty action fallback for empty or unknown failures',error=>{
  expect(actionErrorMessage(error,'Version could not be saved.')).toBe('Version could not be saved.');
});
it('preserves a specific actionable explanation',()=>{
  expect(actionErrorMessage(new Error('This document is in Trash.'),'Failed.')).toBe('This document is in Trash.');
});
