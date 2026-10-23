import { useLayoutEffect, useRef } from 'react';

/**
 * Holds the latest committed `value` for event handlers and async work that
 * outlive a render (IME guards, autosave, slow saves). Read `.current` only
 * outside render; it is updated before the browser can dispatch new events.
 */
export function useLatest<T>(value: T) {
  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; });
  return latest;
}
