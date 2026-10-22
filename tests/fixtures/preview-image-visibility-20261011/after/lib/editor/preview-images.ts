/** Paged.js tolerates image load failures; a printable preview must not. */
export function waitForPreviewImages(root: HTMLElement, signal: AbortSignal, timeoutMs = 15_000): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Preview closed.', 'AbortError'));
  const images = Array.from(root.querySelectorAll('img'));
  if (!images.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const pending = new Set(images);
    const cleanups: (() => void)[] = [];
    const document = root.ownerDocument;
    let settled = false;
    let remaining = timeoutMs;
    let visibleSince: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (visibleSince !== null) remaining = Math.max(0, remaining - (performance.now() - visibleSince));
      visibleSince = null;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; pause();
      signal.removeEventListener('abort', abort);
      document.removeEventListener('visibilitychange', visibility);
      cleanups.forEach(cleanup => cleanup());
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('Preview closed.', 'AbortError'));
    // Match the outer preview's visible-time budget. Background tabs can defer
    // image loading; returning must resume the unused budget, not reset it.
    const resume = () => {
      if (settled || document.hidden || visibleSince !== null) return;
      visibleSince = performance.now();
      timer = setTimeout(() => {
        pause();
        if (!document.hidden) finish(new Error('An image is taking too long to load. Return to editing and check the images before printing.'));
      }, remaining);
    };
    const visibility = () => { if (document.hidden) pause(); else resume(); };
    signal.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', visibility);
    resume();
    for (const [index, image] of images.entries()) {
      const failed = () => finish(new Error(`Image ${index + 1} could not be loaded. Return to editing and replace it before printing.`));
      const loaded = () => {
        if (!image.naturalWidth || !image.naturalHeight) { failed(); return; }
        pending.delete(image);
        if (!pending.size) finish();
      };
      image.addEventListener('load', loaded); image.addEventListener('error', failed);
      cleanups.push(() => { image.removeEventListener('load', loaded); image.removeEventListener('error', failed); });
      if (image.complete) loaded();
      if (settled) break;
    }
  });
}
