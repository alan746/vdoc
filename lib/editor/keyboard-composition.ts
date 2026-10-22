/** Safari can send the candidate-confirming key with isComposing=false
 * while retaining the IME key code. Neither event should trigger app actions.
 */
export function isCompositionKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229;
}
