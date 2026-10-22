// Bounded instrumentation in a fresh owned test origin. No arbitrary eval.
(() => {
  if (window !== top || window.__sevenQA) return;
  window.__sevenQA = true;
  const completed = new Map(), errors = [];
  let busy = false;
  const request = async (route, value) => {
    const response = await fetch(qaPrefix + route, {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
      ...(value === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
    });
    const text = await response.text();
    if (!response.ok) throw Error(route + ': ' + response.status);
    return route === '/command' || route === '/fixture' ? JSON.parse(text) : text;
  };
  const button = name => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === name);
  const state = () => {
    const frame = document.querySelector('iframe[title="Paginated document preview"]');
    return {at:Date.now(),ready:!!window.vdoc,snapshot:window.vdoc?.snapshot(),errors,
      title:document.title,visibility:document.visibilityState,
      status:document.querySelector('.print-preview-controls [role="status"]')?.textContent,
      printReady:!!button('Print / Save PDF') && !button('Print / Save PDF').disabled,
      pages:frame?.contentDocument ? [...frame.contentDocument.querySelectorAll('.pagedjs_page')].map(p=>p.innerText) : []};
  };
  async function run(action) {
    if (action === 'bootstrap') {
      const el = document.querySelector('input[aria-label="Import file into library"]:not(:disabled)');
      if (!el) throw Error('Fresh library not ready');
      const fixture=await request('/fixture'), dt=new DataTransfer();
      dt.items.add(new File([JSON.stringify(fixture)],'seven-gates.vdoc.json',{type:'application/json'}));
      el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));
      return {dispatched:true};
    }
    if (!window.vdoc) throw Error('Document not ready');
    const name = {'preview':'Print','print':'Print / Save PDF','close':'Return to editing'}[action];
    if (!name) throw Error('Unsupported action');
    const b=button(name);if(!b || b.disabled)throw Error('Unavailable: '+name);
    // Acknowledge before the native modal suspends JavaScript.
    setTimeout(()=>b.click(),100);
    return {scheduled:name};
  }
  async function tick() {
    if (busy) return;
    busy=true;
    try {
      document.title='VDoc seven gates native QA';
      const command=await request('/command');
      if(command){
        let ack=completed.get(command.id);
        if(!ack){try{ack={id:command.id,ok:true,result:await run(command.action)}}catch(e){ack={id:command.id,ok:false,error:String(e)}}completed.set(command.id,ack)}
        await request('/ack',ack);
      }
      await request('/state',state());
    } catch(e) {
      errors.push(String(e));if(errors.length>20)errors.shift();
      try{await request('/state',{at:Date.now(),errors,failed:true})}catch{}
    } finally {busy=false}
  }
  setInterval(tick,400);tick();
})();
