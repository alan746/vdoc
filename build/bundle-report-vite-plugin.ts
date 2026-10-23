import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

// vdoc#67: an opt-in report of what the browser bundle contains. `ANALYZE=1
// npm run build` writes dist/bundle-report/client.json; without the flag the
// plugin is inert and the build output is unchanged. No dependency: it reads
// the bundle and module graph the bundler already has.
export function bundleReport({ enabled = false } = {}): Plugin {
  return {
    name: 'vdoc-bundle-report',
    apply: 'build',
    applyToEnvironment: environment => enabled && environment.name === 'client',
    async generateBundle(output, bundle) {
      const root = process.cwd(), name = (id: string) => relative(root, id).replace(/^.*node_modules\//, 'npm:');
      const chunks = Object.values(bundle).flatMap(file => file.type !== 'chunk' ? [] : [{
        file: file.fileName, bytes: Buffer.byteLength(file.code), isEntry: file.isEntry, isDynamicEntry: file.isDynamicEntry,
        imports: file.imports, dynamicImports: file.dynamicImports,
        modules: Object.entries(file.modules).map(([id, info]) => ({ id: name(id), bytes: info.renderedLength }))
          .filter(module => module.bytes > 0).sort((a, b) => b.bytes - a.bytes),
      }]);
      // Static and dynamic importers per module, to trace why a module is in a chunk.
      const graph = Object.fromEntries([...this.getModuleIds()].map(id => {
        const info = this.getModuleInfo(id);
        return [name(id), { importers: info?.importers.map(name) ?? [], dynamicImporters: info?.dynamicImporters.map(name) ?? [] }];
      }));
      const directory = join(output.dir ?? 'dist', '..', 'bundle-report');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'client.json'), JSON.stringify({ chunks, graph }, null, 1));
    },
  };
}
