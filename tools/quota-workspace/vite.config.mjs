import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root, cacheDir: 'tmp/quota-workspace-vite',
  resolve: { alias: { '@': root } },
  plugins: [{ name:'isolated-native-quota-factory', enforce:'pre', transform(code,id) {
    if (id.split('?')[0] !== root+'lib/infrastructure/persistence/document-store.ts') return;
    // Compile-time dependency selection only. All IndexedDB requests,
    // transactions, quota errors, and product save logic remain native/real.
    const transaction="db.transaction(stores, 'readwrite', { durability: 'strict' })";
    if(!code.includes(transaction)) throw new Error('QA transaction observer no longer matches the source.');
    return {code: 'import { indexedDB, observeNativeTransaction } from "/tools/quota-workspace/bucket.ts";\n'+code.replace(transaction,`observeNativeTransaction(${transaction})`),map:null};
  } },react()],
  server: { host:'127.0.0.1', port:4176, strictPort:true, watch:{usePolling:true} },
});
