import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalPdfHandler } from '../../scripts/local-pdf-handler.mjs';
import { renderLocalPdf } from '../../scripts/local-pdf.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  server: { host: 'localhost', port: 5174, strictPort: true },
  plugins: [react(), {
    name: 'preview-test-frame',
    configureServer(server) {
      // Preserve the exact bytes returned by the real Print / Save PDF action
      // for page-count/text and visual checks, outside the tracked source tree.
      const pdf = createLocalPdfHandler({ render: async (snapshot, options) => {
        const bytes = await renderLocalPdf(snapshot, options);
        const directory = new URL('../../tmp/preview-page-breaks/', import.meta.url);
        await mkdir(directory, { recursive: true });
        await writeFile(new URL('printed.pdf', directory), bytes);
        return bytes;
      } });
      server.middlewares.use((request, response, next) => {
        void pdf(request, response, next).catch(next);
      });
      server.middlewares.use((request, _response, next) => {
        if (request.url === '/print-preview') request.url = '/tests/browser/preview-frame.html';
        next();
      });
    },
  }],
});
