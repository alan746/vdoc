/** DOMException can come from another realm, and quota messages may be empty. */
export function actionErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    if ('name' in error && error.name === 'QuotaExceededError') {
      return 'Local storage is full. Download a backup of any unsaved changes, free some space, then try again.';
    }
    if ('message' in error && typeof error.message === 'string' && error.message.trim()) return error.message;
  }
  return fallback;
}
