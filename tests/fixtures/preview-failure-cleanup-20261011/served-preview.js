import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/app/print-preview/page.tsx");const _jsxDEV = __vite__cjsImport13_react_jsxDevRuntime["jsxDEV"]; const _Fragment = __vite__cjsImport13_react_jsxDevRuntime["Fragment"];const useEffect = __vite__cjsImport0_react["useEffect"]; const useRef = __vite__cjsImport0_react["useRef"];"use client";
import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=d499c5a6";
import { previewSource, previewTextMatches, repeatTableHeaders } from "/lib/editor/paged-preview.ts";
import { compactPreviewTables } from "/lib/editor/preview-table-compaction.ts";
import { previewOverflowDetails, previewOverflowMessage, previewMarginOverflow } from "/lib/editor/preview-layout.ts";
import { waitForPreviewImages } from "/lib/editor/preview-images.ts?t=1791749689858";
import { trackPreviewPage } from "/lib/editor/preview-navigation.ts";
import { finishPreviewParagraphBorders } from "/lib/editor/preview-paragraph-borders.ts";
import { previewTableHeaderMismatch, previewTableRowMismatch } from "/lib/editor/preview-table-headers.ts";
import { repairPreviewTableRows, startPreviewRowsOnNewPage } from "/lib/editor/preview-table-row-repair.ts";
import { previewPageBreakMismatch } from "/lib/editor/preview-page-breaks.ts";
import { finalizePreviewFlow } from "/lib/editor/preview-final-flow.ts";
import { installPreviewPrintStyle } from "/lib/editor/preview-print.ts";
import { isCompositionKey } from "/lib/editor/keyboard-composition.ts";
var _jsxFileName = "/Users/ph.qian/Desktop/Vdoc/app/print-preview/page.tsx";
import __vite__cjsImport13_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=d499c5a6";
var _s = $RefreshSig$();
export default function PrintPreviewPage() {
	_s();
	const host = useRef(null);
	useEffect(() => {
		const root = host.current;
		root.replaceChildren();
		const resources = new AbortController();
		let started = false, disposed = false, ready = false, totalPages = 0, token = "", preview;
		let stopTracking;
		let removePrintStyle;
		const stopLayout = () => {
			const current = preview;
			preview = undefined;
			current?.chunker.stop();
			if (current?.polisher.styleEl) current.polisher.destroy();
			root.replaceChildren();
		};
		const releaseResources = () => {
			ready = false;
			stopTracking?.();
			stopTracking = undefined;
			removePrintStyle?.();
			removePrintStyle = undefined;
			resources.abort();
			stopLayout();
		};
		const send = (data) => window.parent.postMessage({
			type: "vdoc-preview-status",
			token,
			...data
		}, window.location.origin);
		const print = () => {
			if (!ready) return;
			try {
				window.print();
				window.parent.postMessage({
					type: "vdoc-preview-print-result",
					token
				}, window.location.origin);
			} catch {
				window.parent.postMessage({
					type: "vdoc-preview-print-result",
					token,
					error: "Could not open the print dialog. Your preview is still available. Try Print / Save PDF again."
				}, window.location.origin);
			}
		};
		const listener = async (event) => {
			if (event.source !== window.parent || event.origin !== window.location.origin) return;
			if (event.data?.type === "vdoc-preview-connect") {
				if (!started) window.parent.postMessage({ type: "vdoc-preview-ready" }, window.location.origin);
				else if (event.data.token === token) window.parent.postMessage({
					type: "vdoc-preview-accepted",
					token
				}, window.location.origin);
				return;
			}
			if (event.data?.type === "vdoc-preview-page" && event.data.token === token && ready && Number.isInteger(event.data.page) && event.data.page >= 1 && event.data.page <= totalPages) {
				root.querySelectorAll(".pagedjs_page")[event.data.page - 1]?.scrollIntoView({ block: "start" });
				return;
			}
			if (event.data?.type === "vdoc-preview-print" && event.data.token === token && ready) {
				print();
				return;
			}
			if (event.data?.type !== "vdoc-preview-render" || started) return;
			started = true;
			token = event.data.token;
			window.parent.postMessage({
				type: "vdoc-preview-accepted",
				token
			}, window.location.origin);
			try {
				const input = event.data.snapshot;
				const source = previewSource(input.title, input.html, input.content);
				document.documentElement.lang = source.language;
				document.title = input.title;
				const original = document.createElement("div");
				original.innerHTML = source.html;
				await waitForPreviewImages(original, resources.signal);
				await document.fonts.ready;
				const { Previewer } = await import("/node_modules/.vite/deps/pagedjs.js?v=d499c5a6");
				if (disposed || !host.current) return;
				let pages = 0;
				let pageCount = 0, bottomReserve = 0;
				// Final table reflow can differ slightly from the paginator's measuring
				// columns. Repaginate once with real breathing room, keeping the same
				// physical paper size and strict final overflow checks.
				for (let layoutAttempt = 0; layoutAttempt < 2; layoutAttempt++) {
					let renderHTML = source.html;
					const css = source.css + (bottomReserve ? `
.pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content { height: calc(100% - var(--pagedjs-footnotes-height) - ${bottomReserve}px) !important; }` : "");
					for (let attempt = 0; attempt < 2; attempt++) {
						preview = new Previewer();
						preview.chunker.hooks.renderNode.register(repeatTableHeaders);
						preview.chunker.hooks.beforePageLayout.register(() => {
							if (disposed || ++pages > 200) throw new Error("This preview exceeds 200 pages or cannot safely paginate this layout.");
						});
						const flow = await preview.preview(renderHTML, [{ [window.location.href]: css }], host.current);
						if (disposed) return;
						await waitForPreviewImages(host.current, resources.signal);
						if (disposed) return;
						// Audit the paginator's complete stream before moving intact cell
						// content into parallel columns (which changes page traversal order).
						if (!previewTextMatches(original, host.current)) throw new Error("Some text could not be paginated reliably. Return to editing or export Word instead.");
						const retry = repairPreviewTableRows(original, host.current);
						if (retry.length && attempt === 0) {
							renderHTML = startPreviewRowsOnNewPage(source.html, retry);
							stopLayout();
							continue;
						}
						pageCount = flow.total;
						break;
					}
					const compacted = compactPreviewTables(original, host.current);
					if (compacted) {
						const compactSource = document.createElement("div");
						compactSource.innerHTML = compacted;
						stopLayout();
						preview = new Previewer();
						preview.chunker.hooks.renderNode.register(repeatTableHeaders);
						preview.chunker.hooks.beforePageLayout.register(() => {
							if (disposed || ++pages > 200) throw new Error("This preview exceeds 200 pages or cannot safely paginate this layout.");
						});
						const flow = await preview.preview(compacted, [{ [window.location.href]: css }], host.current);
						if (disposed) return;
						await waitForPreviewImages(host.current, resources.signal);
						if (disposed) return;
						if (!previewTextMatches(compactSource, host.current)) throw new Error("Some text could not be paginated reliably. Return to editing or export Word instead.");
						pageCount = flow.total;
					}
					finalizePreviewFlow(host.current);
					finishPreviewParagraphBorders(host.current);
					const breakMismatch = previewPageBreakMismatch(original, host.current);
					if (breakMismatch !== null) throw new Error(`A page break was not preserved near page ${breakMismatch}. Return to editing or export Word instead.`);
					const headerMismatch = previewTableHeaderMismatch(original, host.current);
					if (headerMismatch !== null) throw new Error(`Table headers could not be repeated reliably on page ${headerMismatch}. Return to editing or export Word instead.`);
					const rowMismatch = previewTableRowMismatch(original, host.current);
					if (rowMismatch !== null) throw new Error(`Table cells became misaligned across pages near page ${rowMismatch}. Split long rows into smaller rows or export Word instead.`);
					const overflow = previewOverflowDetails(host.current);
					if (overflow !== null) {
						if (layoutAttempt === 0 && overflow.edge === "bottom" && overflow.pixels > 0 && overflow.pixels <= 8) {
							bottomReserve = overflow.pixels + 2;
							stopLayout();
							continue;
						}
						throw new Error(previewOverflowMessage(overflow));
					}
					const marginOverflow = previewMarginOverflow(host.current);
					if (marginOverflow) throw new Error(`${marginOverflow.part} does not fit on page ${marginOverflow.page}. Increase page margins or shorten the header or footer before printing.`);
					break;
				}
				host.current.querySelectorAll(".pagedjs_page").forEach((page, index) => {
					page.setAttribute("role", "region");
					page.setAttribute("aria-label", `Page ${index + 1}`);
				});
				removePrintStyle = installPreviewPrintStyle(document, input.content);
				totalPages = pageCount;
				ready = true;
				send({
					state: "ready",
					pages: pageCount,
					fittedTables: source.fittedTables
				});
				stopTracking = trackPreviewPage(root, (page) => window.parent.postMessage({
					type: "vdoc-preview-current-page",
					token,
					page
				}, window.location.origin));
			} catch (error) {
				if (!disposed) {
					// Release failed work before notifying the parent. A delayed parent
					// unmount must not leave a paginator or its styles alive in the frame.
					releaseResources();
					send({
						state: "error",
						error: error instanceof Error ? error.message : "Page preview failed."
					});
				}
			}
		};
		const keyboard = (event) => {
			if (event.key === "Escape" && !isCompositionKey(event)) {
				event.preventDefault();
				window.parent.postMessage({
					type: "vdoc-preview-close",
					token
				}, window.location.origin);
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
				event.preventDefault();
				if (!event.repeat && !isCompositionKey(event)) print();
			}
		};
		const click = (event) => {
			if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
		};
		window.addEventListener("keydown", keyboard);
		window.addEventListener("click", click);
		window.addEventListener("message", listener);
		window.parent.postMessage({ type: "vdoc-preview-ready" }, window.location.origin);
		return () => {
			disposed = true;
			releaseResources();
			window.removeEventListener("message", listener);
			window.removeEventListener("keydown", keyboard);
			window.removeEventListener("click", click);
		};
	}, []);
	return /* @__PURE__ */ _jsxDEV(_Fragment, { children: [/* @__PURE__ */ _jsxDEV("style", { children: `
    html,body { height:auto!important; overflow:auto!important; margin:0!important; background:#e9edf4!important; }
    #preview-pages { padding:24px; min-width:max-content; }
    .pagedjs_pages { display:flex; flex-direction:column; gap:24px; align-items:center; }
    .pagedjs_page { flex:none; box-shadow:0 1px 10px #26344d20; }
    @media print { html,body { background:white!important; } #preview-pages { padding:0; } .pagedjs_pages { display:block; } .pagedjs_page { box-shadow:none; margin:0; break-after:page; } .pagedjs_page:last-child { break-after:auto; } }
  ` }, void 0, false, {
		fileName: _jsxFileName,
		lineNumber: 152,
		columnNumber: 12
	}, this), /* @__PURE__ */ _jsxDEV("div", {
		ref: host,
		id: "preview-pages",
		"aria-label": "Paginated document"
	}, void 0, false, {
		fileName: _jsxFileName,
		lineNumber: 158,
		columnNumber: 13
	}, this)] }, void 0, true, {
		fileName: _jsxFileName,
		lineNumber: 152,
		columnNumber: 10
	}, this);
}
_s(PrintPreviewPage, "C/Ss9xXYUJbgpVuNv48stEcujlw=");
_c = PrintPreviewPage;
var _c;
$RefreshReg$(_c, "PrintPreviewPage");
import * as RefreshRuntime from "/@react-refresh";
const inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
import * as __vite_react_currentExports from "/app/print-preview/page.tsx?t=1791750657687";
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "@vitejs/plugin-react can't detect preamble. Something is wrong."
    );
  }

  const currentExports = __vite_react_currentExports;
  queueMicrotask(() => {
    RefreshRuntime.registerExportsForReactRefresh("/Users/ph.qian/Desktop/Vdoc/app/print-preview/page.tsx", currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate("/Users/ph.qian/Desktop/Vdoc/app/print-preview/page.tsx", currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
function $RefreshReg$(type, id) { return RefreshRuntime.register(type, "/Users/ph.qian/Desktop/Vdoc/app/print-preview/page.tsx" + ' ' + id); }
function $RefreshSig$() { return RefreshRuntime.createSignatureFunctionForTransform(); }

//# sourceMappingURL=data:application/json;base64,eyJtYXBwaW5ncyI6IkFBQUE7QUFDQSxTQUFTLFdBQVcsY0FBYztBQUNsQyxTQUFTLGVBQWUsb0JBQW9CLDBCQUEwQjtBQUN0RSxTQUFTLDRCQUE0QjtBQUVyQyxTQUFTLHdCQUF3Qix3QkFBd0IsNkJBQTZCO0FBQ3RGLFNBQVMsNEJBQTRCO0FBQ3JDLFNBQVMsd0JBQXdCO0FBQ2pDLFNBQVMscUNBQXFDO0FBQzlDLFNBQVMsNEJBQTRCLCtCQUErQjtBQUNwRSxTQUFTLHdCQUF3QixpQ0FBaUM7QUFDbEUsU0FBUyxnQ0FBZ0M7QUFDekMsU0FBUywyQkFBMkI7QUFDcEMsU0FBUyxnQ0FBZ0M7QUFDekMsU0FBUyx3QkFBd0I7Ozs7QUFFakMsZUFBZSxTQUFTLG1CQUFtQjs7Q0FDekMsTUFBTSxPQUFPLE9BQXVCLElBQUk7Q0FDeEMsZ0JBQWdCO0VBQ2QsTUFBTSxPQUFPLEtBQUs7RUFBVSxLQUFLLGdCQUFnQjtFQUNqRCxNQUFNLFlBQVksSUFBSSxnQkFBZ0I7RUFDdEMsSUFBSSxVQUFVLE9BQU8sV0FBVyxPQUFPLFFBQVEsT0FBTyxhQUFhLEdBQUcsUUFBUSxJQUFJO0VBQ2xGLElBQUk7RUFDSixJQUFJO0VBQ0osTUFBTSxtQkFBbUI7R0FDdkIsTUFBTSxVQUFVO0dBQ2hCLFVBQVU7R0FDVixTQUFTLFFBQVEsS0FBSztHQUN0QixJQUFJLFNBQVMsU0FBUyxTQUFTLFFBQVEsU0FBUyxRQUFRO0dBQ3hELEtBQUssZ0JBQWdCO0VBQ3ZCO0VBQ0EsTUFBTSx5QkFBeUI7R0FDN0IsUUFBUTtHQUNSLGVBQWU7R0FBRyxlQUFlO0dBQ2pDLG1CQUFtQjtHQUFHLG1CQUFtQjtHQUN6QyxVQUFVLE1BQU07R0FDaEIsV0FBVztFQUNiO0VBQ0EsTUFBTSxRQUFRLFNBQWlCLE9BQU8sT0FBTyxZQUFZO0dBQUUsTUFBSztHQUF1QjtHQUFPLEdBQUc7RUFBSyxHQUFHLE9BQU8sU0FBUyxNQUFNO0VBQy9ILE1BQU0sY0FBYztHQUNsQixJQUFJLENBQUMsT0FBTztHQUNaLElBQUk7SUFDRixPQUFPLE1BQU07SUFDYixPQUFPLE9BQU8sWUFBWTtLQUFDLE1BQUs7S0FBNEI7SUFBSyxHQUFFLE9BQU8sU0FBUyxNQUFNO0dBQzNGLFFBQVE7SUFDTixPQUFPLE9BQU8sWUFBWTtLQUFDLE1BQUs7S0FBNEI7S0FBTSxPQUFNO0lBQStGLEdBQUUsT0FBTyxTQUFTLE1BQU07R0FDak07RUFDRjtFQUNBLE1BQU0sV0FBVyxPQUFPLFVBQXdCO0dBQzlDLElBQUksTUFBTSxXQUFXLE9BQU8sVUFBVSxNQUFNLFdBQVcsT0FBTyxTQUFTLFFBQVE7R0FDL0UsSUFBSSxNQUFNLE1BQU0sU0FBUyx3QkFBd0I7SUFDL0MsSUFBSSxDQUFDLFNBQVMsT0FBTyxPQUFPLFlBQVksRUFBQyxNQUFLLHFCQUFvQixHQUFFLE9BQU8sU0FBUyxNQUFNO1NBQ3JGLElBQUksTUFBTSxLQUFLLFVBQVUsT0FBTyxPQUFPLE9BQU8sWUFBWTtLQUFDLE1BQUs7S0FBd0I7SUFBSyxHQUFFLE9BQU8sU0FBUyxNQUFNO0lBQzFIO0dBQ0Y7R0FDQSxJQUFJLE1BQU0sTUFBTSxTQUFTLHVCQUF1QixNQUFNLEtBQUssVUFBVSxTQUFTLFNBQVMsT0FBTyxVQUFVLE1BQU0sS0FBSyxJQUFJLEtBQUssTUFBTSxLQUFLLFFBQVEsS0FBSyxNQUFNLEtBQUssUUFBUSxZQUFZO0lBQUUsS0FBSyxpQkFBaUIsZUFBZSxFQUFFLE1BQU0sS0FBSyxPQUFPLElBQUksZUFBZSxFQUFDLE9BQU0sUUFBTyxDQUFDO0lBQUc7R0FBUTtHQUMzUixJQUFJLE1BQU0sTUFBTSxTQUFTLHdCQUF3QixNQUFNLEtBQUssVUFBVSxTQUFTLE9BQU87SUFBRSxNQUFNO0lBQUc7R0FBUTtHQUN6RyxJQUFJLE1BQU0sTUFBTSxTQUFTLHlCQUF5QixTQUFTO0dBQzNELFVBQVU7R0FBTSxRQUFRLE1BQU0sS0FBSztHQUNuQyxPQUFPLE9BQU8sWUFBWTtJQUFDLE1BQUs7SUFBd0I7R0FBSyxHQUFFLE9BQU8sU0FBUyxNQUFNO0dBQ3JGLElBQUk7SUFDRixNQUFNLFFBQVEsTUFBTSxLQUFLO0lBQ3pCLE1BQU0sU0FBUyxjQUFjLE1BQU0sT0FBTyxNQUFNLE1BQU0sTUFBTSxPQUFPO0lBQ25FLFNBQVMsZ0JBQWdCLE9BQU8sT0FBTztJQUFVLFNBQVMsUUFBUSxNQUFNO0lBQ3hFLE1BQU0sV0FBVyxTQUFTLGNBQWMsS0FBSztJQUFHLFNBQVMsWUFBWSxPQUFPO0lBQzVFLE1BQU0scUJBQXFCLFVBQVUsVUFBVSxNQUFNO0lBQ3JELE1BQU0sU0FBUyxNQUFNO0lBQ3JCLE1BQU0sRUFBRSxjQUFjLE1BQU0sT0FBTztJQUNuQyxJQUFJLFlBQVksQ0FBQyxLQUFLLFNBQVM7SUFDL0IsSUFBSSxRQUFRO0lBQ1osSUFBSSxZQUFVLEdBQUcsZ0JBQWM7Ozs7SUFJL0IsS0FBSyxJQUFJLGdCQUFjLEdBQUcsZ0JBQWMsR0FBRyxpQkFBaUI7S0FDMUQsSUFBSSxhQUFXLE9BQU87S0FDdEIsTUFBTSxNQUFJLE9BQU8sT0FBTyxnQkFBZ0I7bUhBQ2lFLGNBQWMscUJBQXFCO0tBQzVJLEtBQUksSUFBSSxVQUFRLEdBQUUsVUFBUSxHQUFFLFdBQVc7TUFDckMsVUFBVSxJQUFJLFVBQVU7TUFDeEIsUUFBUSxRQUFRLE1BQU0sV0FBVyxTQUFTLGtCQUFrQjtNQUM1RCxRQUFRLFFBQVEsTUFBTSxpQkFBaUIsZUFBZTtPQUFFLElBQUksWUFBWSxFQUFFLFFBQVEsS0FBSyxNQUFNLElBQUksTUFBTSx1RUFBdUU7TUFBRyxDQUFDO01BQ2xMLE1BQU0sT0FBTyxNQUFNLFFBQVEsUUFBUSxZQUFZLENBQUMsR0FBRyxPQUFPLFNBQVMsT0FBTSxJQUFJLENBQUMsR0FBRyxLQUFLLE9BQU87TUFDN0YsSUFBSSxVQUFVO01BQ2QsTUFBTSxxQkFBcUIsS0FBSyxTQUFVLFVBQVUsTUFBTTtNQUMxRCxJQUFJLFVBQVU7OztNQUdkLElBQUksQ0FBQyxtQkFBbUIsVUFBVSxLQUFLLE9BQVEsR0FBRyxNQUFNLElBQUksTUFBTSxzRkFBc0Y7TUFDeEosTUFBTSxRQUFNLHVCQUF1QixVQUFTLEtBQUssT0FBUTtNQUN6RCxJQUFHLE1BQU0sVUFBUSxZQUFVLEdBQUc7T0FDNUIsYUFBVywwQkFBMEIsT0FBTyxNQUFLLEtBQUs7T0FDdEQsV0FBVztPQUFFO01BQ2Y7TUFDQSxZQUFVLEtBQUs7TUFBTTtLQUN2QjtLQUNBLE1BQU0sWUFBVSxxQkFBcUIsVUFBUyxLQUFLLE9BQVE7S0FDM0QsSUFBRyxXQUFXO01BQ1osTUFBTSxnQkFBYyxTQUFTLGNBQWMsS0FBSztNQUFFLGNBQWMsWUFBVTtNQUMxRSxXQUFXO01BQUUsVUFBUSxJQUFJLFVBQVU7TUFDbkMsUUFBUSxRQUFRLE1BQU0sV0FBVyxTQUFTLGtCQUFrQjtNQUM1RCxRQUFRLFFBQVEsTUFBTSxpQkFBaUIsZUFBYTtPQUFDLElBQUcsWUFBVSxFQUFFLFFBQU0sS0FBSSxNQUFNLElBQUksTUFBTSx1RUFBdUU7TUFBRSxDQUFDO01BQ3hLLE1BQU0sT0FBSyxNQUFNLFFBQVEsUUFBUSxXQUFVLENBQUMsR0FBRSxPQUFPLFNBQVMsT0FBTSxJQUFHLENBQUMsR0FBRSxLQUFLLE9BQU87TUFDdEYsSUFBRyxVQUFTO01BQ1osTUFBTSxxQkFBcUIsS0FBSyxTQUFTLFVBQVUsTUFBTTtNQUFFLElBQUcsVUFBUztNQUN2RSxJQUFHLENBQUMsbUJBQW1CLGVBQWMsS0FBSyxPQUFRLEdBQUUsTUFBTSxJQUFJLE1BQU0sc0ZBQXNGO01BQzFKLFlBQVUsS0FBSztLQUNqQjtLQUNBLG9CQUFvQixLQUFLLE9BQVE7S0FDakMsOEJBQThCLEtBQUssT0FBUTtLQUMzQyxNQUFNLGdCQUFnQix5QkFBeUIsVUFBVSxLQUFLLE9BQVE7S0FDdEUsSUFBSSxrQkFBa0IsTUFBTSxNQUFNLElBQUksTUFBTSw0Q0FBNEMsY0FBYyw0Q0FBNEM7S0FDbEosTUFBTSxpQkFBaUIsMkJBQTJCLFVBQVMsS0FBSyxPQUFRO0tBQ3hFLElBQUcsbUJBQW1CLE1BQU0sTUFBTSxJQUFJLE1BQU0sd0RBQXdELGVBQWUsNENBQTRDO0tBQy9KLE1BQU0sY0FBYyx3QkFBd0IsVUFBUyxLQUFLLE9BQVE7S0FDbEUsSUFBRyxnQkFBZ0IsTUFBTSxNQUFNLElBQUksTUFBTSx3REFBd0QsWUFBWSw0REFBNEQ7S0FDekssTUFBTSxXQUFXLHVCQUF1QixLQUFLLE9BQVE7S0FDckQsSUFBSSxhQUFhLE1BQU07TUFDckIsSUFBSSxrQkFBZ0IsS0FBSyxTQUFTLFNBQU8sWUFBWSxTQUFTLFNBQU8sS0FBSyxTQUFTLFVBQVEsR0FBRztPQUM1RixnQkFBYyxTQUFTLFNBQU87T0FDOUIsV0FBVztPQUFFO01BQ2Y7TUFDQSxNQUFNLElBQUksTUFBTSx1QkFBdUIsUUFBUSxDQUFDO0tBQ2xEO0tBQ0EsTUFBTSxpQkFBaUIsc0JBQXNCLEtBQUssT0FBUTtLQUMxRCxJQUFJLGdCQUFnQixNQUFNLElBQUksTUFBTSxHQUFHLGVBQWUsS0FBSyx3QkFBd0IsZUFBZSxLQUFLLHlFQUF5RTtLQUNoTDtJQUNGO0lBQ0EsS0FBSyxRQUFTLGlCQUFpQixlQUFlLEVBQUUsU0FBUyxNQUFLLFVBQVE7S0FBQyxLQUFLLGFBQWEsUUFBTyxRQUFRO0tBQUUsS0FBSyxhQUFhLGNBQWEsUUFBUSxRQUFNLEdBQUc7SUFBRSxDQUFDO0lBQzdKLG1CQUFtQix5QkFBeUIsVUFBVSxNQUFNLE9BQU87SUFDbkUsYUFBYTtJQUFXLFFBQVE7SUFBTSxLQUFLO0tBQUMsT0FBTTtLQUFRLE9BQU07S0FBVSxjQUFhLE9BQU87SUFBWSxDQUFDO0lBQzNHLGVBQWUsaUJBQWlCLE9BQU0sU0FBUSxPQUFPLE9BQU8sWUFBWTtLQUFDLE1BQUs7S0FBNEI7S0FBTTtJQUFJLEdBQUUsT0FBTyxTQUFTLE1BQU0sQ0FBQztHQUMvSSxTQUFTLE9BQU87SUFDZCxJQUFJLENBQUMsVUFBVTs7O0tBR2IsaUJBQWlCO0tBQ2pCLEtBQUs7TUFBQyxPQUFNO01BQVEsT0FBTSxpQkFBaUIsUUFBUSxNQUFNLFVBQVU7S0FBc0IsQ0FBQztJQUM1RjtHQUNGO0VBQ0Y7RUFDQSxNQUFNLFlBQVksVUFBeUI7R0FDekMsSUFBSSxNQUFNLFFBQVEsWUFBWSxDQUFDLGlCQUFpQixLQUFLLEdBQUc7SUFBRSxNQUFNLGVBQWU7SUFBRyxPQUFPLE9BQU8sWUFBWTtLQUFDLE1BQUs7S0FBcUI7SUFBSyxHQUFFLE9BQU8sU0FBUyxNQUFNO0dBQUc7R0FDdkssS0FBSyxNQUFNLFdBQVcsTUFBTSxZQUFZLE1BQU0sSUFBSSxZQUFZLE1BQU0sS0FBSztJQUFFLE1BQU0sZUFBZTtJQUFHLElBQUksQ0FBQyxNQUFNLFVBQVUsQ0FBQyxpQkFBaUIsS0FBSyxHQUFHLE1BQU07R0FBRztFQUM3SjtFQUNBLE1BQU0sU0FBUyxVQUFzQjtHQUFFLElBQUksTUFBTSxrQkFBa0IsV0FBVyxNQUFNLE9BQU8sUUFBUSxHQUFHLEdBQUcsTUFBTSxlQUFlO0VBQUc7RUFDakksT0FBTyxpQkFBaUIsV0FBVSxRQUFRO0VBQUcsT0FBTyxpQkFBaUIsU0FBUSxLQUFLO0VBQ2xGLE9BQU8saUJBQWlCLFdBQVcsUUFBUTtFQUMzQyxPQUFPLE9BQU8sWUFBWSxFQUFDLE1BQUsscUJBQW9CLEdBQUcsT0FBTyxTQUFTLE1BQU07RUFDN0UsYUFBYTtHQUFFLFdBQVc7R0FBTSxpQkFBaUI7R0FBRyxPQUFPLG9CQUFvQixXQUFXLFFBQVE7R0FBRyxPQUFPLG9CQUFvQixXQUFVLFFBQVE7R0FBRyxPQUFPLG9CQUFvQixTQUFRLEtBQUs7RUFBRztDQUNsTSxHQUFHLENBQUMsQ0FBQztDQUNMLE9BQU8sZ0RBQUUsd0JBQUMsU0FBRCxZQUFROzs7Ozs7SUFNUjs7OztXQUFDLHdCQUFDLE9BQUQ7RUFBSyxLQUFLO0VBQU0sSUFBRztFQUFnQixjQUFXO0NBQXNCOzs7O1NBQUc7Ozs7O0FBQ25GIiwibmFtZXMiOltdLCJzb3VyY2VzIjpbInBhZ2UudHN4Il0sInZlcnNpb24iOjMsInNvdXJjZXNDb250ZW50IjpbIid1c2UgY2xpZW50JztcbmltcG9ydCB7IHVzZUVmZmVjdCwgdXNlUmVmIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IHsgcHJldmlld1NvdXJjZSwgcHJldmlld1RleHRNYXRjaGVzLCByZXBlYXRUYWJsZUhlYWRlcnMgfSBmcm9tICdAL2xpYi9lZGl0b3IvcGFnZWQtcHJldmlldyc7XG5pbXBvcnQgeyBjb21wYWN0UHJldmlld1RhYmxlcyB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LXRhYmxlLWNvbXBhY3Rpb24nO1xuaW1wb3J0IHR5cGUgeyBQcmV2aWV3ZXIgfSBmcm9tICdwYWdlZGpzJztcbmltcG9ydCB7IHByZXZpZXdPdmVyZmxvd0RldGFpbHMsIHByZXZpZXdPdmVyZmxvd01lc3NhZ2UsIHByZXZpZXdNYXJnaW5PdmVyZmxvdyB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LWxheW91dCc7XG5pbXBvcnQgeyB3YWl0Rm9yUHJldmlld0ltYWdlcyB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LWltYWdlcyc7XG5pbXBvcnQgeyB0cmFja1ByZXZpZXdQYWdlIH0gZnJvbSAnQC9saWIvZWRpdG9yL3ByZXZpZXctbmF2aWdhdGlvbic7XG5pbXBvcnQgeyBmaW5pc2hQcmV2aWV3UGFyYWdyYXBoQm9yZGVycyB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LXBhcmFncmFwaC1ib3JkZXJzJztcbmltcG9ydCB7IHByZXZpZXdUYWJsZUhlYWRlck1pc21hdGNoLCBwcmV2aWV3VGFibGVSb3dNaXNtYXRjaCB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LXRhYmxlLWhlYWRlcnMnO1xuaW1wb3J0IHsgcmVwYWlyUHJldmlld1RhYmxlUm93cywgc3RhcnRQcmV2aWV3Um93c09uTmV3UGFnZSB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LXRhYmxlLXJvdy1yZXBhaXInO1xuaW1wb3J0IHsgcHJldmlld1BhZ2VCcmVha01pc21hdGNoIH0gZnJvbSAnQC9saWIvZWRpdG9yL3ByZXZpZXctcGFnZS1icmVha3MnO1xuaW1wb3J0IHsgZmluYWxpemVQcmV2aWV3RmxvdyB9IGZyb20gJ0AvbGliL2VkaXRvci9wcmV2aWV3LWZpbmFsLWZsb3cnO1xuaW1wb3J0IHsgaW5zdGFsbFByZXZpZXdQcmludFN0eWxlIH0gZnJvbSAnQC9saWIvZWRpdG9yL3ByZXZpZXctcHJpbnQnO1xuaW1wb3J0IHsgaXNDb21wb3NpdGlvbktleSB9IGZyb20gJ0AvbGliL2VkaXRvci9rZXlib2FyZC1jb21wb3NpdGlvbic7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFByaW50UHJldmlld1BhZ2UoKSB7XG4gIGNvbnN0IGhvc3QgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IHJvb3QgPSBob3N0LmN1cnJlbnQhOyByb290LnJlcGxhY2VDaGlsZHJlbigpO1xuICAgIGNvbnN0IHJlc291cmNlcyA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBsZXQgc3RhcnRlZCA9IGZhbHNlLCBkaXNwb3NlZCA9IGZhbHNlLCByZWFkeSA9IGZhbHNlLCB0b3RhbFBhZ2VzID0gMCwgdG9rZW4gPSAnJywgcHJldmlldzogUHJldmlld2VyIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzdG9wVHJhY2tpbmc6ICgoKSA9PiB2b2lkKSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgcmVtb3ZlUHJpbnRTdHlsZTogKCgpID0+IHZvaWQpIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IHN0b3BMYXlvdXQgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjdXJyZW50ID0gcHJldmlldztcbiAgICAgIHByZXZpZXcgPSB1bmRlZmluZWQ7XG4gICAgICBjdXJyZW50Py5jaHVua2VyLnN0b3AoKTtcbiAgICAgIGlmIChjdXJyZW50Py5wb2xpc2hlci5zdHlsZUVsKSBjdXJyZW50LnBvbGlzaGVyLmRlc3Ryb3koKTtcbiAgICAgIHJvb3QucmVwbGFjZUNoaWxkcmVuKCk7XG4gICAgfTtcbiAgICBjb25zdCByZWxlYXNlUmVzb3VyY2VzID0gKCkgPT4ge1xuICAgICAgcmVhZHkgPSBmYWxzZTtcbiAgICAgIHN0b3BUcmFja2luZz8uKCk7IHN0b3BUcmFja2luZyA9IHVuZGVmaW5lZDtcbiAgICAgIHJlbW92ZVByaW50U3R5bGU/LigpOyByZW1vdmVQcmludFN0eWxlID0gdW5kZWZpbmVkO1xuICAgICAgcmVzb3VyY2VzLmFib3J0KCk7XG4gICAgICBzdG9wTGF5b3V0KCk7XG4gICAgfTtcbiAgICBjb25zdCBzZW5kID0gKGRhdGE6IG9iamVjdCkgPT4gd2luZG93LnBhcmVudC5wb3N0TWVzc2FnZSh7IHR5cGU6J3Zkb2MtcHJldmlldy1zdGF0dXMnLCB0b2tlbiwgLi4uZGF0YSB9LCB3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICBjb25zdCBwcmludCA9ICgpID0+IHtcbiAgICAgIGlmICghcmVhZHkpIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIHdpbmRvdy5wcmludCgpO1xuICAgICAgICB3aW5kb3cucGFyZW50LnBvc3RNZXNzYWdlKHt0eXBlOid2ZG9jLXByZXZpZXctcHJpbnQtcmVzdWx0Jyx0b2tlbn0sd2luZG93LmxvY2F0aW9uLm9yaWdpbik7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgd2luZG93LnBhcmVudC5wb3N0TWVzc2FnZSh7dHlwZTondmRvYy1wcmV2aWV3LXByaW50LXJlc3VsdCcsdG9rZW4sZXJyb3I6J0NvdWxkIG5vdCBvcGVuIHRoZSBwcmludCBkaWFsb2cuIFlvdXIgcHJldmlldyBpcyBzdGlsbCBhdmFpbGFibGUuIFRyeSBQcmludCAvIFNhdmUgUERGIGFnYWluLid9LHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pO1xuICAgICAgfVxuICAgIH07XG4gICAgY29uc3QgbGlzdGVuZXIgPSBhc3luYyAoZXZlbnQ6IE1lc3NhZ2VFdmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LnNvdXJjZSAhPT0gd2luZG93LnBhcmVudCB8fCBldmVudC5vcmlnaW4gIT09IHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pIHJldHVybjtcbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAndmRvYy1wcmV2aWV3LWNvbm5lY3QnKSB7XG4gICAgICAgIGlmICghc3RhcnRlZCkgd2luZG93LnBhcmVudC5wb3N0TWVzc2FnZSh7dHlwZTondmRvYy1wcmV2aWV3LXJlYWR5J30sd2luZG93LmxvY2F0aW9uLm9yaWdpbik7XG4gICAgICAgIGVsc2UgaWYgKGV2ZW50LmRhdGEudG9rZW4gPT09IHRva2VuKSB3aW5kb3cucGFyZW50LnBvc3RNZXNzYWdlKHt0eXBlOid2ZG9jLXByZXZpZXctYWNjZXB0ZWQnLHRva2VufSx3aW5kb3cubG9jYXRpb24ub3JpZ2luKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKGV2ZW50LmRhdGE/LnR5cGUgPT09ICd2ZG9jLXByZXZpZXctcGFnZScgJiYgZXZlbnQuZGF0YS50b2tlbiA9PT0gdG9rZW4gJiYgcmVhZHkgJiYgTnVtYmVyLmlzSW50ZWdlcihldmVudC5kYXRhLnBhZ2UpICYmIGV2ZW50LmRhdGEucGFnZSA+PSAxICYmIGV2ZW50LmRhdGEucGFnZSA8PSB0b3RhbFBhZ2VzKSB7IHJvb3QucXVlcnlTZWxlY3RvckFsbCgnLnBhZ2VkanNfcGFnZScpW2V2ZW50LmRhdGEucGFnZSAtIDFdPy5zY3JvbGxJbnRvVmlldyh7YmxvY2s6J3N0YXJ0J30pOyByZXR1cm47IH1cbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlID09PSAndmRvYy1wcmV2aWV3LXByaW50JyAmJiBldmVudC5kYXRhLnRva2VuID09PSB0b2tlbiAmJiByZWFkeSkgeyBwcmludCgpOyByZXR1cm47IH1cbiAgICAgIGlmIChldmVudC5kYXRhPy50eXBlICE9PSAndmRvYy1wcmV2aWV3LXJlbmRlcicgfHwgc3RhcnRlZCkgcmV0dXJuO1xuICAgICAgc3RhcnRlZCA9IHRydWU7IHRva2VuID0gZXZlbnQuZGF0YS50b2tlbjtcbiAgICAgIHdpbmRvdy5wYXJlbnQucG9zdE1lc3NhZ2Uoe3R5cGU6J3Zkb2MtcHJldmlldy1hY2NlcHRlZCcsdG9rZW59LHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSBldmVudC5kYXRhLnNuYXBzaG90O1xuICAgICAgICBjb25zdCBzb3VyY2UgPSBwcmV2aWV3U291cmNlKGlucHV0LnRpdGxlLCBpbnB1dC5odG1sLCBpbnB1dC5jb250ZW50KTtcbiAgICAgICAgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmxhbmcgPSBzb3VyY2UubGFuZ3VhZ2U7IGRvY3VtZW50LnRpdGxlID0gaW5wdXQudGl0bGU7XG4gICAgICAgIGNvbnN0IG9yaWdpbmFsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7IG9yaWdpbmFsLmlubmVySFRNTCA9IHNvdXJjZS5odG1sO1xuICAgICAgICBhd2FpdCB3YWl0Rm9yUHJldmlld0ltYWdlcyhvcmlnaW5hbCwgcmVzb3VyY2VzLnNpZ25hbCk7XG4gICAgICAgIGF3YWl0IGRvY3VtZW50LmZvbnRzLnJlYWR5O1xuICAgICAgICBjb25zdCB7IFByZXZpZXdlciB9ID0gYXdhaXQgaW1wb3J0KCdwYWdlZGpzJyk7XG4gICAgICAgIGlmIChkaXNwb3NlZCB8fCAhaG9zdC5jdXJyZW50KSByZXR1cm47XG4gICAgICAgIGxldCBwYWdlcyA9IDA7XG4gICAgICAgIGxldCBwYWdlQ291bnQ9MCwgYm90dG9tUmVzZXJ2ZT0wO1xuICAgICAgICAvLyBGaW5hbCB0YWJsZSByZWZsb3cgY2FuIGRpZmZlciBzbGlnaHRseSBmcm9tIHRoZSBwYWdpbmF0b3IncyBtZWFzdXJpbmdcbiAgICAgICAgLy8gY29sdW1ucy4gUmVwYWdpbmF0ZSBvbmNlIHdpdGggcmVhbCBicmVhdGhpbmcgcm9vbSwga2VlcGluZyB0aGUgc2FtZVxuICAgICAgICAvLyBwaHlzaWNhbCBwYXBlciBzaXplIGFuZCBzdHJpY3QgZmluYWwgb3ZlcmZsb3cgY2hlY2tzLlxuICAgICAgICBmb3IgKGxldCBsYXlvdXRBdHRlbXB0PTA7IGxheW91dEF0dGVtcHQ8MjsgbGF5b3V0QXR0ZW1wdCsrKSB7XG4gICAgICAgICAgbGV0IHJlbmRlckhUTUw9c291cmNlLmh0bWw7XG4gICAgICAgICAgY29uc3QgY3NzPXNvdXJjZS5jc3MgKyAoYm90dG9tUmVzZXJ2ZSA/IGBcbi5wYWdlZGpzX3BhZ2Vib3ggPiAucGFnZWRqc19hcmVhID4gLnBhZ2VkanNfcGFnZV9jb250ZW50IHsgaGVpZ2h0OiBjYWxjKDEwMCUgLSB2YXIoLS1wYWdlZGpzLWZvb3Rub3Rlcy1oZWlnaHQpIC0gJHtib3R0b21SZXNlcnZlfXB4KSAhaW1wb3J0YW50OyB9YCA6ICcnKTtcbiAgICAgICAgICBmb3IobGV0IGF0dGVtcHQ9MDthdHRlbXB0PDI7YXR0ZW1wdCsrKSB7XG4gICAgICAgICAgICBwcmV2aWV3ID0gbmV3IFByZXZpZXdlcigpO1xuICAgICAgICAgICAgcHJldmlldy5jaHVua2VyLmhvb2tzLnJlbmRlck5vZGUucmVnaXN0ZXIocmVwZWF0VGFibGVIZWFkZXJzKTtcbiAgICAgICAgICAgIHByZXZpZXcuY2h1bmtlci5ob29rcy5iZWZvcmVQYWdlTGF5b3V0LnJlZ2lzdGVyKCgpID0+IHsgaWYgKGRpc3Bvc2VkIHx8ICsrcGFnZXMgPiAyMDApIHRocm93IG5ldyBFcnJvcignVGhpcyBwcmV2aWV3IGV4Y2VlZHMgMjAwIHBhZ2VzIG9yIGNhbm5vdCBzYWZlbHkgcGFnaW5hdGUgdGhpcyBsYXlvdXQuJyk7IH0pO1xuICAgICAgICAgICAgY29uc3QgZmxvdyA9IGF3YWl0IHByZXZpZXcucHJldmlldyhyZW5kZXJIVE1MLCBbeyBbd2luZG93LmxvY2F0aW9uLmhyZWZdOmNzcyB9XSwgaG9zdC5jdXJyZW50KTtcbiAgICAgICAgICAgIGlmIChkaXNwb3NlZCkgcmV0dXJuO1xuICAgICAgICAgICAgYXdhaXQgd2FpdEZvclByZXZpZXdJbWFnZXMoaG9zdC5jdXJyZW50ISwgcmVzb3VyY2VzLnNpZ25hbCk7XG4gICAgICAgICAgICBpZiAoZGlzcG9zZWQpIHJldHVybjtcbiAgICAgICAgICAgIC8vIEF1ZGl0IHRoZSBwYWdpbmF0b3IncyBjb21wbGV0ZSBzdHJlYW0gYmVmb3JlIG1vdmluZyBpbnRhY3QgY2VsbFxuICAgICAgICAgICAgLy8gY29udGVudCBpbnRvIHBhcmFsbGVsIGNvbHVtbnMgKHdoaWNoIGNoYW5nZXMgcGFnZSB0cmF2ZXJzYWwgb3JkZXIpLlxuICAgICAgICAgICAgaWYgKCFwcmV2aWV3VGV4dE1hdGNoZXMob3JpZ2luYWwsIGhvc3QuY3VycmVudCEpKSB0aHJvdyBuZXcgRXJyb3IoJ1NvbWUgdGV4dCBjb3VsZCBub3QgYmUgcGFnaW5hdGVkIHJlbGlhYmx5LiBSZXR1cm4gdG8gZWRpdGluZyBvciBleHBvcnQgV29yZCBpbnN0ZWFkLicpO1xuICAgICAgICAgICAgY29uc3QgcmV0cnk9cmVwYWlyUHJldmlld1RhYmxlUm93cyhvcmlnaW5hbCxob3N0LmN1cnJlbnQhKTtcbiAgICAgICAgICAgIGlmKHJldHJ5Lmxlbmd0aCYmYXR0ZW1wdD09PTApIHtcbiAgICAgICAgICAgICAgcmVuZGVySFRNTD1zdGFydFByZXZpZXdSb3dzT25OZXdQYWdlKHNvdXJjZS5odG1sLHJldHJ5KTtcbiAgICAgICAgICAgICAgc3RvcExheW91dCgpO2NvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGFnZUNvdW50PWZsb3cudG90YWw7YnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGNvbXBhY3RlZD1jb21wYWN0UHJldmlld1RhYmxlcyhvcmlnaW5hbCxob3N0LmN1cnJlbnQhKTtcbiAgICAgICAgICBpZihjb21wYWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IGNvbXBhY3RTb3VyY2U9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7Y29tcGFjdFNvdXJjZS5pbm5lckhUTUw9Y29tcGFjdGVkO1xuICAgICAgICAgICAgc3RvcExheW91dCgpO3ByZXZpZXc9bmV3IFByZXZpZXdlcigpO1xuICAgICAgICAgICAgcHJldmlldy5jaHVua2VyLmhvb2tzLnJlbmRlck5vZGUucmVnaXN0ZXIocmVwZWF0VGFibGVIZWFkZXJzKTtcbiAgICAgICAgICAgIHByZXZpZXcuY2h1bmtlci5ob29rcy5iZWZvcmVQYWdlTGF5b3V0LnJlZ2lzdGVyKCgpPT57aWYoZGlzcG9zZWR8fCsrcGFnZXM+MjAwKXRocm93IG5ldyBFcnJvcignVGhpcyBwcmV2aWV3IGV4Y2VlZHMgMjAwIHBhZ2VzIG9yIGNhbm5vdCBzYWZlbHkgcGFnaW5hdGUgdGhpcyBsYXlvdXQuJyk7fSk7XG4gICAgICAgICAgICBjb25zdCBmbG93PWF3YWl0IHByZXZpZXcucHJldmlldyhjb21wYWN0ZWQsW3tbd2luZG93LmxvY2F0aW9uLmhyZWZdOmNzc31dLGhvc3QuY3VycmVudCk7XG4gICAgICAgICAgICBpZihkaXNwb3NlZClyZXR1cm47XG4gICAgICAgICAgICBhd2FpdCB3YWl0Rm9yUHJldmlld0ltYWdlcyhob3N0LmN1cnJlbnQhLHJlc291cmNlcy5zaWduYWwpO2lmKGRpc3Bvc2VkKXJldHVybjtcbiAgICAgICAgICAgIGlmKCFwcmV2aWV3VGV4dE1hdGNoZXMoY29tcGFjdFNvdXJjZSxob3N0LmN1cnJlbnQhKSl0aHJvdyBuZXcgRXJyb3IoJ1NvbWUgdGV4dCBjb3VsZCBub3QgYmUgcGFnaW5hdGVkIHJlbGlhYmx5LiBSZXR1cm4gdG8gZWRpdGluZyBvciBleHBvcnQgV29yZCBpbnN0ZWFkLicpO1xuICAgICAgICAgICAgcGFnZUNvdW50PWZsb3cudG90YWw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZpbmFsaXplUHJldmlld0Zsb3coaG9zdC5jdXJyZW50ISk7XG4gICAgICAgICAgZmluaXNoUHJldmlld1BhcmFncmFwaEJvcmRlcnMoaG9zdC5jdXJyZW50ISk7XG4gICAgICAgICAgY29uc3QgYnJlYWtNaXNtYXRjaCA9IHByZXZpZXdQYWdlQnJlYWtNaXNtYXRjaChvcmlnaW5hbCwgaG9zdC5jdXJyZW50ISk7XG4gICAgICAgICAgaWYgKGJyZWFrTWlzbWF0Y2ggIT09IG51bGwpIHRocm93IG5ldyBFcnJvcihgQSBwYWdlIGJyZWFrIHdhcyBub3QgcHJlc2VydmVkIG5lYXIgcGFnZSAke2JyZWFrTWlzbWF0Y2h9LiBSZXR1cm4gdG8gZWRpdGluZyBvciBleHBvcnQgV29yZCBpbnN0ZWFkLmApO1xuICAgICAgICAgIGNvbnN0IGhlYWRlck1pc21hdGNoID0gcHJldmlld1RhYmxlSGVhZGVyTWlzbWF0Y2gob3JpZ2luYWwsaG9zdC5jdXJyZW50ISk7XG4gICAgICAgICAgaWYoaGVhZGVyTWlzbWF0Y2ggIT09IG51bGwpIHRocm93IG5ldyBFcnJvcihgVGFibGUgaGVhZGVycyBjb3VsZCBub3QgYmUgcmVwZWF0ZWQgcmVsaWFibHkgb24gcGFnZSAke2hlYWRlck1pc21hdGNofS4gUmV0dXJuIHRvIGVkaXRpbmcgb3IgZXhwb3J0IFdvcmQgaW5zdGVhZC5gKTtcbiAgICAgICAgICBjb25zdCByb3dNaXNtYXRjaCA9IHByZXZpZXdUYWJsZVJvd01pc21hdGNoKG9yaWdpbmFsLGhvc3QuY3VycmVudCEpO1xuICAgICAgICAgIGlmKHJvd01pc21hdGNoICE9PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlIGNlbGxzIGJlY2FtZSBtaXNhbGlnbmVkIGFjcm9zcyBwYWdlcyBuZWFyIHBhZ2UgJHtyb3dNaXNtYXRjaH0uIFNwbGl0IGxvbmcgcm93cyBpbnRvIHNtYWxsZXIgcm93cyBvciBleHBvcnQgV29yZCBpbnN0ZWFkLmApO1xuICAgICAgICAgIGNvbnN0IG92ZXJmbG93ID0gcHJldmlld092ZXJmbG93RGV0YWlscyhob3N0LmN1cnJlbnQhKTtcbiAgICAgICAgICBpZiAob3ZlcmZsb3cgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGlmIChsYXlvdXRBdHRlbXB0PT09MCAmJiBvdmVyZmxvdy5lZGdlPT09J2JvdHRvbScgJiYgb3ZlcmZsb3cucGl4ZWxzPjAgJiYgb3ZlcmZsb3cucGl4ZWxzPD04KSB7XG4gICAgICAgICAgICAgIGJvdHRvbVJlc2VydmU9b3ZlcmZsb3cucGl4ZWxzKzI7XG4gICAgICAgICAgICAgIHN0b3BMYXlvdXQoKTtjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihwcmV2aWV3T3ZlcmZsb3dNZXNzYWdlKG92ZXJmbG93KSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IG1hcmdpbk92ZXJmbG93ID0gcHJldmlld01hcmdpbk92ZXJmbG93KGhvc3QuY3VycmVudCEpO1xuICAgICAgICAgIGlmIChtYXJnaW5PdmVyZmxvdykgdGhyb3cgbmV3IEVycm9yKGAke21hcmdpbk92ZXJmbG93LnBhcnR9IGRvZXMgbm90IGZpdCBvbiBwYWdlICR7bWFyZ2luT3ZlcmZsb3cucGFnZX0uIEluY3JlYXNlIHBhZ2UgbWFyZ2lucyBvciBzaG9ydGVuIHRoZSBoZWFkZXIgb3IgZm9vdGVyIGJlZm9yZSBwcmludGluZy5gKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBob3N0LmN1cnJlbnQhLnF1ZXJ5U2VsZWN0b3JBbGwoJy5wYWdlZGpzX3BhZ2UnKS5mb3JFYWNoKChwYWdlLGluZGV4KT0+e3BhZ2Uuc2V0QXR0cmlidXRlKCdyb2xlJywncmVnaW9uJyk7cGFnZS5zZXRBdHRyaWJ1dGUoJ2FyaWEtbGFiZWwnLGBQYWdlICR7aW5kZXgrMX1gKTt9KTtcbiAgICAgICAgcmVtb3ZlUHJpbnRTdHlsZSA9IGluc3RhbGxQcmV2aWV3UHJpbnRTdHlsZShkb2N1bWVudCwgaW5wdXQuY29udGVudCk7XG4gICAgICAgIHRvdGFsUGFnZXMgPSBwYWdlQ291bnQ7IHJlYWR5ID0gdHJ1ZTsgc2VuZCh7c3RhdGU6J3JlYWR5JyxwYWdlczpwYWdlQ291bnQsZml0dGVkVGFibGVzOnNvdXJjZS5maXR0ZWRUYWJsZXN9KTtcbiAgICAgICAgc3RvcFRyYWNraW5nID0gdHJhY2tQcmV2aWV3UGFnZShyb290LCBwYWdlID0+IHdpbmRvdy5wYXJlbnQucG9zdE1lc3NhZ2Uoe3R5cGU6J3Zkb2MtcHJldmlldy1jdXJyZW50LXBhZ2UnLHRva2VuLHBhZ2V9LHdpbmRvdy5sb2NhdGlvbi5vcmlnaW4pKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghZGlzcG9zZWQpIHtcbiAgICAgICAgICAvLyBSZWxlYXNlIGZhaWxlZCB3b3JrIGJlZm9yZSBub3RpZnlpbmcgdGhlIHBhcmVudC4gQSBkZWxheWVkIHBhcmVudFxuICAgICAgICAgIC8vIHVubW91bnQgbXVzdCBub3QgbGVhdmUgYSBwYWdpbmF0b3Igb3IgaXRzIHN0eWxlcyBhbGl2ZSBpbiB0aGUgZnJhbWUuXG4gICAgICAgICAgcmVsZWFzZVJlc291cmNlcygpO1xuICAgICAgICAgIHNlbmQoe3N0YXRlOidlcnJvcicsZXJyb3I6ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnUGFnZSBwcmV2aWV3IGZhaWxlZC4nfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGNvbnN0IGtleWJvYXJkID0gKGV2ZW50OiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSAnRXNjYXBlJyAmJiAhaXNDb21wb3NpdGlvbktleShldmVudCkpIHsgZXZlbnQucHJldmVudERlZmF1bHQoKTsgd2luZG93LnBhcmVudC5wb3N0TWVzc2FnZSh7dHlwZTondmRvYy1wcmV2aWV3LWNsb3NlJyx0b2tlbn0sd2luZG93LmxvY2F0aW9uLm9yaWdpbik7IH1cbiAgICAgIGlmICgoZXZlbnQubWV0YUtleSB8fCBldmVudC5jdHJsS2V5KSAmJiBldmVudC5rZXkudG9Mb3dlckNhc2UoKSA9PT0gJ3AnKSB7IGV2ZW50LnByZXZlbnREZWZhdWx0KCk7IGlmICghZXZlbnQucmVwZWF0ICYmICFpc0NvbXBvc2l0aW9uS2V5KGV2ZW50KSkgcHJpbnQoKTsgfVxuICAgIH07XG4gICAgY29uc3QgY2xpY2sgPSAoZXZlbnQ6IE1vdXNlRXZlbnQpID0+IHsgaWYgKGV2ZW50LnRhcmdldCBpbnN0YW5jZW9mIEVsZW1lbnQgJiYgZXZlbnQudGFyZ2V0LmNsb3Nlc3QoJ2EnKSkgZXZlbnQucHJldmVudERlZmF1bHQoKTsgfTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsa2V5Ym9hcmQpOyB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLGNsaWNrKTtcbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGxpc3RlbmVyKTtcbiAgICB3aW5kb3cucGFyZW50LnBvc3RNZXNzYWdlKHt0eXBlOid2ZG9jLXByZXZpZXctcmVhZHknfSwgd2luZG93LmxvY2F0aW9uLm9yaWdpbik7XG4gICAgcmV0dXJuICgpID0+IHsgZGlzcG9zZWQgPSB0cnVlOyByZWxlYXNlUmVzb3VyY2VzKCk7IHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgbGlzdGVuZXIpOyB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsa2V5Ym9hcmQpOyB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xpY2snLGNsaWNrKTsgfTtcbiAgfSwgW10pO1xuICByZXR1cm4gPD48c3R5bGU+e2BcbiAgICBodG1sLGJvZHkgeyBoZWlnaHQ6YXV0byFpbXBvcnRhbnQ7IG92ZXJmbG93OmF1dG8haW1wb3J0YW50OyBtYXJnaW46MCFpbXBvcnRhbnQ7IGJhY2tncm91bmQ6I2U5ZWRmNCFpbXBvcnRhbnQ7IH1cbiAgICAjcHJldmlldy1wYWdlcyB7IHBhZGRpbmc6MjRweDsgbWluLXdpZHRoOm1heC1jb250ZW50OyB9XG4gICAgLnBhZ2VkanNfcGFnZXMgeyBkaXNwbGF5OmZsZXg7IGZsZXgtZGlyZWN0aW9uOmNvbHVtbjsgZ2FwOjI0cHg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgfVxuICAgIC5wYWdlZGpzX3BhZ2UgeyBmbGV4Om5vbmU7IGJveC1zaGFkb3c6MCAxcHggMTBweCAjMjYzNDRkMjA7IH1cbiAgICBAbWVkaWEgcHJpbnQgeyBodG1sLGJvZHkgeyBiYWNrZ3JvdW5kOndoaXRlIWltcG9ydGFudDsgfSAjcHJldmlldy1wYWdlcyB7IHBhZGRpbmc6MDsgfSAucGFnZWRqc19wYWdlcyB7IGRpc3BsYXk6YmxvY2s7IH0gLnBhZ2VkanNfcGFnZSB7IGJveC1zaGFkb3c6bm9uZTsgbWFyZ2luOjA7IGJyZWFrLWFmdGVyOnBhZ2U7IH0gLnBhZ2VkanNfcGFnZTpsYXN0LWNoaWxkIHsgYnJlYWstYWZ0ZXI6YXV0bzsgfSB9XG4gIGB9PC9zdHlsZT48ZGl2IHJlZj17aG9zdH0gaWQ9XCJwcmV2aWV3LXBhZ2VzXCIgYXJpYS1sYWJlbD1cIlBhZ2luYXRlZCBkb2N1bWVudFwiIC8+PC8+O1xufVxuIl19