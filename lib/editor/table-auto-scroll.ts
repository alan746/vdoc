/** Screen pixels per second; a narrow viewport must not have overlapping edge zones. */
export function edgeScrollSpeed(point: number, start: number, end: number): number {
  if (end <= start || point < start - 12 || point > end + 12) return 0;
  const edge = Math.min(48, (end - start) / 3);
  if (point < start + edge) return -720 * Math.min(1, (start + edge - point) / edge);
  if (point > end - edge) return 720 * Math.min(1, (point - end + edge) / edge);
  return 0;
}

/** Scroll presentation only. The caller commits a single document operation on drop. */
export function createTableAutoScroll(
  axis: 'row' | 'column', canvas: HTMLElement, wrapper: HTMLElement, table: HTMLElement,
  onScroll: () => void,
  frames = { request: (callback: FrameRequestCallback) => requestAnimationFrame(callback), cancel: (id: number) => cancelAnimationFrame(id) },
) {
  let point: { x: number; y: number } | null = null, frame = 0, previousTime = 0, destroyed = false;
  const tick = (time: number) => {
    frame = 0;
    if (!point || destroyed || !table.isConnected) return;
    const view = canvas.getBoundingClientRect(), clip = wrapper.getBoundingClientRect(), bounds = table.getBoundingClientRect();
    const elapsed = previousTime ? Math.min(32, Math.max(0, time - previousTime)) / 1000 : 1 / 60;
    previousTime = time;
    let speed = 0;
    if (axis === 'row') {
      if (point.x >= Math.max(view.left, clip.left - 65) && point.x <= Math.min(view.right, clip.right + 65)) {
        speed = edgeScrollSpeed(point.y, view.top, view.bottom);
        if (speed < 0 && bounds.top >= view.top || speed > 0 && bounds.bottom <= view.bottom) speed = 0;
      }
    } else if (point.y >= Math.max(view.top, bounds.top - 40) && point.y <= Math.min(view.bottom, bounds.bottom)) {
      speed = edgeScrollSpeed(point.x, Math.max(view.left, clip.left), Math.min(view.right, clip.right));
    }
    if (!speed) return;
    const container = axis === 'row' ? canvas : wrapper;
    const scale = axis === 'row' ? 1 : clip.width / wrapper.offsetWidth || 1;
    const before = axis === 'row' ? container.scrollTop : container.scrollLeft;
    const max = axis === 'row' ? container.scrollHeight - container.clientHeight : container.scrollWidth - container.clientWidth;
    const next = Math.max(0, Math.min(max, before + speed * elapsed / scale));
    if (axis === 'row') container.scrollTop = next; else container.scrollLeft = next;
    const after = axis === 'row' ? container.scrollTop : container.scrollLeft;
    if (after === before) return;
    onScroll();
    if (!destroyed) frame = frames.request(tick);
  };
  return {
    update(x: number, y: number) {
      if (destroyed) return;
      point = { x, y };
      if (!frame) { previousTime = 0; frame = frames.request(tick); }
    },
    destroy() { destroyed = true; point = null; if (frame) frames.cancel(frame); frame = 0; },
  };
}
