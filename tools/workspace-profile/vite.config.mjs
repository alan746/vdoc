import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root: `${root}tools/workspace-profile`,
  plugins: [{
    name: 'profile-selector-work',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/components/editor/use-engine-selector.ts')) return;
      return code.replace('snapshot = select(engine);', `
        const start = performance.now();
        snapshot = select(engine);
        performance.measure('vdoc-selector', { start, end: performance.now() });
      `);
    },
  }, react(), {
    name: 'save-local-profile',
    configurePreviewServer(server) {
      server.middlewares.use('/profile-result', (request, response, next) => {
        if (request.method !== 'POST') return next();
        let body = '';
        request.on('data', chunk => { body += chunk; if (body.length > 1_000_000) request.destroy(); });
        request.on('end', async () => {
          try {
            const result = JSON.parse(body);
            const directory = `${root}dist/workspace-profile/results`;
            await mkdir(directory, { recursive: true });
            await writeFile(`${directory}/${Date.now()}.json`, JSON.stringify(result, null, 2) + '\n');
            response.end('Saved');
          } catch { response.statusCode = 400; response.end('Invalid result'); }
        });
      });
    },
  }],
  resolve: { alias: [
    { find: '@', replacement: root },
    { find: /^react-dom\/client$/, replacement: 'react-dom/profiling' },
  ] },
  css: { postcss: root },
  build: { outDir: `${root}dist/workspace-profile`, emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 8770, strictPort: true },
});
