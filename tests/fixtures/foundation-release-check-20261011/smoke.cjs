// Current production build only. Isolated browser storage; no user browser access.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const {chromium} = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = 'tests/fixtures/foundation-release-check-20261011';
const origin = 'http://127.0.0.1:4187';
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'blockId').map(([key, val]) => [key, normalize(val)])) : value;
(async () => {
  const report = {at: new Date().toISOString(), checks: [], consoleErrors: [], pageErrors: [], failedRequests: [], externalRequests: []};
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
  try {
    report.browser = browser.version();
    const context = await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      report.externalRequests.push(url.origin); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', message => {if(message.type() === 'error') report.consoleErrors.push(message.text());});
    page.on('requestfailed', request => report.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
    const snapshot = () => page.evaluate(() => window.vdoc.snapshot());
    const check = name => report.checks.push({name,passed:true});
    await page.goto(origin);
    await page.getByLabel('Import file into library').setInputFiles('tests/fixtures/safari-preview/source.vdoc.json');
    await page.waitForFunction(() => !!window.vdoc);
    const initial = await snapshot();
    const source = JSON.parse(await fs.readFile('tests/fixtures/safari-preview/source.vdoc.json','utf8'));
    assert.deepEqual(normalize(initial.document),normalize(source.content)); check('import preserves complete content except newly assigned block IDs');
    const edited = await page.evaluate(() => {
      const api = window.vdoc, s = api.snapshot(), target = s.blocks.at(-1);
      const request = {id:'release-smoke-insert',expectedSessionId:s.sessionId,expectedRevision:s.revision,target:{kind:'range',from:target.to,to:target.to},operations:[{type:'text.insert',text:' Release QA 中文 العربية हिन्दी עברית.'}]};
      const result = api.execute(request), after = api.snapshot();
      const stale = api.execute({...request,id:'release-smoke-stale'});
      return {result,after,stale,afterStale:api.snapshot()};
    });
    assert.equal(edited.result.ok,true); assert.equal(edited.stale.code,'STALE');
    assert.deepEqual(edited.after.document,edited.afterStale.document);check('revision guard rejects stale edit without modifying document');
    assert.equal((await page.evaluate(() => window.vdoc.undo())).ok,true);
    assert.deepEqual((await snapshot()).document,initial.document);check('undo restores exact complete document');
    assert.equal((await page.evaluate(() => window.vdoc.redo())).ok,true);
    assert.deepEqual((await snapshot()).document,edited.after.document);check('redo restores exact multilingual edit');
    await page.waitForFunction(() => document.querySelector('.save-indicator')?.textContent.includes('Saved locally'));
    const url = page.url(); await page.reload(); await page.waitForFunction(() => !!window.vdoc);
    assert.deepEqual((await snapshot()).document,edited.after.document);check('reload preserves complete edited document');
    const fresh = await snapshot();
    const staleSession = await page.evaluate(old => window.vdoc.execute({id:'release-old-session',expectedSessionId:old.sessionId,expectedRevision:old.revision,target:{kind:'range',from:1,to:1},operations:[{type:'text.insert',text:'WRONG'}]}),initial);
    assert.equal(staleSession.code,'STALE');assert.deepEqual((await snapshot()).document,fresh.document);check('old editor session rejected after reload');
    await page.getByRole('textbox',{name:'Document body'}).click(); await page.keyboard.press('Meta+f');
    await page.getByLabel('Find text',{exact:true}).fill('FINAL PAGE CHECK');
    await page.waitForFunction(() => {const m=document.querySelector('.vdoc-search-current'), c=document.querySelector('.canvas-scroll');if(!m||!c)return false;const r=m.getBoundingClientRect(),b=c.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom&&r.left>=b.left&&r.right<=b.right;});
    check('search scrolls final-page sentence into view');
    await page.getByRole('button',{name:'Print',exact:true}).click();
    await page.getByRole('button',{name:'Print / Save PDF',exact:true}).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Print / Save PDF'&&!b.disabled),null,{timeout:60000});
    const frame = page.frameLocator('iframe[title="Paginated document preview"]');
    const pages = frame.locator('.pagedjs_page');assert.equal(await pages.count(),5);
    const last = await pages.last().innerText();assert.match(last,/FINAL PAGE CHECK/);assert.match(last,/Release QA/);check('five-page preview includes original final paragraph and new multilingual edit');
    await page.screenshot({path:out+'/preview.png'});
    await page.getByRole('button',{name:'Return to editing',exact:true}).click();
    assert.deepEqual((await snapshot()).document,fresh.document);check('closing preview leaves entire document unchanged');
    await page.getByRole('button',{name:'File',exact:true}).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('menuitem',{name:'Download VDoc backup'}).click();
    const download = await downloadEvent;await download.saveAs(out+'/edited.vdoc.json');
    const backup = JSON.parse(await fs.readFile(out+'/edited.vdoc.json','utf8'));
    assert.deepEqual(backup.content,fresh.document);check('actual downloaded backup matches complete current content');
    report.documentURL=url;report.sourceDocument=initial.document;report.editedDocument=fresh.document;
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.externalRequests,[]);
    report.passed=true;
  } catch (error) {report.passed=false;report.error=error.stack;throw error;}
  finally {await fs.writeFile(out+'/smoke.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
