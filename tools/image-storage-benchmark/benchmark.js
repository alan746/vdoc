// Deliberately independent of the production database and application code.
const mode = new URLSearchParams(location.search).get('mode') === 'references' ? 'references' : 'inline';
const databaseName = `vdoc-image-benchmark-${mode}`;
const output = document.querySelector('#result');
const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
});
const heap = () => performance.memory?.usedJSHeapSize ?? null;
const estimate = async () => {
  const value = await navigator.storage.estimate();
  return { usage: value.usage, quota: value.quota, indexedDB: value.usageDetails?.indexedDB ?? null };
};
const dataURL = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
async function images() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
  const result = [];
  // Seeded incompressible RGBA pixels produce real PNGs, not mislabeled random bytes.
  let seed = 0x12345678;
  for (let n = 0; n < 10; n++) {
    for (let i = 0; i < pixels.data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels.data[i] = seed & 255;
    }
    ctx.putImageData(pixels, 0, 0);
    result.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
  }
  return result;
}
const stats = values => {
  const sorted = [...values].sort((a,b) => a-b);
  return { median: sorted[Math.floor(sorted.length/2)], p95: sorted[Math.ceil(sorted.length*.95)-1], samples: values };
};
document.querySelector('#run').addEventListener('click', async event => {
  event.target.disabled = true;
  let db;
  try {
    output.textContent = `Running ${mode}…`;
    await request(indexedDB.deleteDatabase(databaseName));
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => {
      for (const name of ['documents', 'versions', 'images']) opening.result.createObjectStore(name);
    };
    db = await request(opening);
    const storageBefore = await estimate(), heapBefore = heap();
    let blobs = await images();
    const imageBytes = blobs.reduce((sum, blob) => sum + blob.size, 0);
    const start = performance.now();
    let sources;
    if (mode === 'inline') sources = await Promise.all(blobs.map(dataURL));
    else {
      const entries = await Promise.all(blobs.map(async blob => {
        const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const key = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
        return { key, blob, mime: blob.type, byteLength: blob.size };
      }));
      const tx = db.transaction('images', 'readwrite', { durability: 'strict' }), settled = done(tx);
      entries.forEach(({ key, ...value }) => tx.objectStore('images').put(value, key));
      await settled;
      sources = entries.map(({ key }) => `vdoc-image:${key}`);
    }
    const preparationMs = performance.now()-start;
    blobs = null;
    const content = { type: 'doc', content: sources.map(src => ({type:'image',attrs:{src}})) };
    const document = { id:'benchmark', title:'Image benchmark', version:1, content };
    const documentJSONBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
    let tx = db.transaction(['documents','versions'], 'readwrite', {durability:'strict'}), settled = done(tx);
    tx.objectStore('documents').put(document, 'benchmark');
    for (let i=0;i<10;i++) tx.objectStore('versions').put({title:document.title,content}, `version-${i}`);
    await settled;
    const autosave = [], enqueue = [];
    for (let i=0;i<35;i++) {
      document.title = `Edit ${i}`;
      const start = performance.now();
      tx = db.transaction('documents', 'readwrite', {durability:'strict'}); settled = done(tx);
      tx.objectStore('documents').put(document, 'benchmark');
      const queued = performance.now()-start;
      await settled;
      if(i>=5) { autosave.push(performance.now()-start); enqueue.push(queued); }
    }
    // Read all versions as the current version-list path does; retain until sampling.
    const versions = await request(db.transaction('versions').objectStore('versions').getAll());
    const heapAfterVersionRead = heap(), storageAfter = await estimate();
    const result = {mode,userAgent:navigator.userAgent,timestamp:new Date().toISOString(),imageBytes,
      versions:versions.length,documentJSONBytes,preparationMs,autosaveMs:stats(autosave),enqueueMs:stats(enqueue),
      storageBefore,storageAfter,storageUsageDelta:storageAfter.usage-storageBefore.usage,
      heapBefore,heapAfterVersionRead,heapDelta:heapBefore===null?null:heapAfterVersionRead-heapBefore,
      caveats:'Heap is a coarse non-standard Chromium sample, without forced GC; includes encoding and temporary allocations. Storage estimates are origin-wide, asynchronously accounted and not exact file sizes. This is a persistence prototype, not a migrated app or decoded-image memory benchmark.'};
    db.close(); db = null;
    await request(indexedDB.deleteDatabase(databaseName));
    output.textContent = JSON.stringify(result,null,2);
  } catch(error) { output.textContent = String(error?.stack ?? error); }
  finally { db?.close(); event.target.disabled = false; }
});
