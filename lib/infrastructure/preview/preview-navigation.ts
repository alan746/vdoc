/** Track the page occupying most of the viewport, without doing layout work on every scroll event. */
export function trackPreviewPage(root: HTMLElement, report: (page: number) => void) {
  const view = root.ownerDocument.defaultView!;
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_page'));
  let frame = 0, current = 0;
  const update = () => {
    frame = 0;
    let best = 0, visible = 0;
    pages.forEach((page, index) => {
      const rect = page.getBoundingClientRect();
      const height = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0));
      if (height > visible) { visible = height; best = index + 1; }
    });
    if (best && best !== current) { current = best; report(best); }
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(update); };
  view.addEventListener('scroll', schedule, { passive: true });
  view.addEventListener('resize', schedule);
  update();
  return () => {
    view.removeEventListener('scroll', schedule);
    view.removeEventListener('resize', schedule);
    if (frame) view.cancelAnimationFrame(frame);
  };
}
