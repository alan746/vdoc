'use client';
import { useEffect, useState } from 'react';
import { isCloudWorkspace } from '@/lib/composition/repositories';
import VdocWorkspace from './workspace';

export function LocalWorkspace() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Defensive boundary if a client router reaches / from a cloud tab.
    if (isCloudWorkspace()) { window.location.reload(); return; }
    queueMicrotask(() => setReady(true));
  }, []);
  return ready ? <VdocWorkspace /> : <div role="status">Opening workspace…</div>;
}
