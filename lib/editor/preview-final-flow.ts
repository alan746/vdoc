/** Paged.js uses off-page CSS columns to find page breaks. Once the DOM has
 * been split into pages those measuring columns must not fragment it again
 * (notably table rowspans in WebKit). Keep a BFC so margins do not escape the
 * content box, and audit all text/object geometry after this final reflow. */
export function finalizePreviewFlow(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.pagedjs_page_content').forEach(content => {
    content.style.setProperty('column-width', 'auto', 'important');
    content.style.setProperty('column-count', 'auto', 'important');
    content.style.setProperty('column-gap', 'normal', 'important');
    content.style.setProperty('display', 'flow-root', 'important');
    content.dataset.previewFinalFlow = 'true';
  });
}
