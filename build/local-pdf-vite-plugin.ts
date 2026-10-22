import type { Plugin } from 'vite';
import { createLocalPdfHandler } from '../scripts/local-pdf-handler.mjs';

// The hosted Worker has no native browser process. This adapter is confined to
// the single-user local runtime; the UI detects availability before using it.
export function localPdf({ enabled = false } = {}): Plugin {
  return {
    name: 'vdoc-local-pdf',
    configureServer(server) {
      if (!enabled) return;
      const handler = createLocalPdfHandler();
      server.middlewares.use((request, response, next) => {
        void handler(request, response, next).catch(next);
      });
    },
  };
}
