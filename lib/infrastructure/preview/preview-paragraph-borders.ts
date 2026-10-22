import { paragraphBordersSchema, type ParagraphBorders } from '../../editor/paragraph/paragraph-borders';

const selector = 'p[data-paragraph-borders],h1[data-paragraph-borders],h2[data-paragraph-borders],h3[data-paragraph-borders],h4[data-paragraph-borders],h5[data-paragraph-borders],h6[data-paragraph-borders]';
function borders(node: Element): ParagraphBorders | null {
  try {
    const value = paragraphBordersSchema.safeParse(JSON.parse(node.getAttribute('data-paragraph-borders') || 'null'));
    return value.success ? value.data : null;
  } catch { return null; }
}
/** Reserve caps before pagination. Drawing them afterwards must not reflow text.
 * Important padding also survives Paged.js's split-fragment padding reset. */
export function preparePreviewParagraphBorders(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(selector).forEach(node => {
    const edges = borders(node); if (!edges) return;
    const joined = node.dataset.paragraphBorderJoin === 'true';
    const previous = joined && node.dataset.vdocBorderPrev === 'true';
    const next = joined && node.dataset.vdocBorderNext === 'true';
    const top = previous ? edges.between : edges.top;
    // Reuse the existing padding when it can contain a page cap; only grow a
    // zero/small gap when otherwise the cap would paint over the text.
    const topSpace = Math.max((top?.padding ?? edges.top?.padding ?? 0) * 4 / 3 + (top?.width || 0), edges.top?.width || 0);
    const bottomSpace = Math.max((edges.bottom?.padding || 0) * 4 / 3 + (next ? 0 : edges.bottom?.width || 0), edges.bottom?.width || 0);
    node.dataset.previewParagraphBorder = 'true';
    node.style.setProperty('position', 'relative');
    node.style.setProperty('border-top', '0', 'important');
    node.style.setProperty('border-bottom', '0', 'important');
    node.style.setProperty('padding-top', `${topSpace}px`, 'important');
    node.style.setProperty('padding-bottom', `${bottomSpace}px`, 'important');
  });
}
/** Connect only immediate siblings actually present on this page. A continued
 * paragraph or group gets its own outer caps; table cells remain independent. */
export function finishPreviewParagraphBorders(root: HTMLElement) {
  root.querySelectorAll('[data-preview-border-line]').forEach(line => line.remove());
  root.querySelectorAll<HTMLElement>('.pagedjs_page').forEach(page => {
    page.querySelectorAll<HTMLElement>('[data-preview-paragraph-border]').forEach(node => {
      const edges = borders(node); if (!edges) return;
      const key = node.getAttribute('data-paragraph-border-key');
      const connects = (other: Element | null, direction: 'prev' | 'next') => Boolean(
        key && node.dataset.paragraphBorderJoin === 'true' && node.getAttribute(`data-vdoc-border-${direction}`) === 'true' &&
        other?.matches(selector) && other.closest('.pagedjs_page') === page &&
        other.getAttribute('data-paragraph-border-join') === 'true' && other.getAttribute('data-paragraph-border-key') === key &&
        other.getAttribute(`data-vdoc-border-${direction === 'prev' ? 'next' : 'prev'}`) === 'true'
      );
      const previous = connects(node.previousElementSibling, 'prev'), next = connects(node.nextElementSibling, 'next');
      node.dataset.previewBorderStart = String(!previous); node.dataset.previewBorderEnd = String(!next);
      const draw = (side: 'top' | 'bottom', edge: ParagraphBorders['top']) => {
        if (!edge) return;
        const line = root.ownerDocument.createElement('span');
        line.dataset.previewBorderLine = side; line.setAttribute('aria-hidden', 'true');
        // These empty, absolute spans neither alter text completeness nor layout.
        line.style.cssText = `position:absolute;display:block;pointer-events:none;box-sizing:border-box;height:0;left:${-(edges.left?.width || 0)}px;right:${-(edges.right?.width || 0)}px;${side}:0;border-top:${edge.width}px ${edge.style} ${edge.color};`;
        node.appendChild(line);
      };
      draw('top', previous ? edges.between : edges.top);
      draw('bottom', next ? undefined : edges.bottom);
    });
  });
}
