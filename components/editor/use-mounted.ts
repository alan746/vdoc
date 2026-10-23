import { useEffect, useRef } from 'react';

/** `current` is false once the component has unmounted; async work checks it before touching state. */
export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
