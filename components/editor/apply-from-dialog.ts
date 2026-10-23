import { toast } from 'sonner';
import type { DocumentEngine } from '@/lib/usecases/engine';

/** Applies a dialog's operations as one toolbar edit. On success runs `onApplied`
 * (usually closing the dialog); otherwise shows the engine's error and leaves it open.
 * Operations are validated by the engine, like any other request. */
export function applyFromDialog(engine: DocumentEngine, operations: unknown[], onApplied: () => void, label?: string) {
  const result = engine.execute({ source: 'toolbar', ...(label ? { label } : {}), operations });
  if (result.ok) onApplied(); else toast.error(result.error);
  return result.ok;
}
