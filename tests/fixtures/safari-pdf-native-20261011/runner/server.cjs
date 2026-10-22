// Test-only, fresh loopback origin. Bounded commands, no arbitrary evaluation.
const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('tmp/safari-pdf-native'),evidence=path.resolve('tests/fixtures/safari-pdf-native-20261011');let delivered='';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/safari-preview/source.vdoc.json'));fixture.title='QA Safari PDF native 20261011';
const server=http.createServer((req,res)=>{
 if(req.url!=='/__qa/command')fs.appendFileSync(path.join(dir,'requests.log'),JSON.stringify({at:Date.now(),method:req.method,url:req.url})+'\n');
 if(req.headers.host!=='127.0.0.1:4188'){res.writeHead(403);res.end();return}
 if(req.url.startsWith('/__qa/')){
  res.setHeader('Cache-Control','no-store');
  if(/^\/__qa\/diagnostic\/(single-page-control|plain-control|full-sheet|intrinsic-height-control)$/.test(req.url)){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(dir,req.url.split('/').pop()+'.html')));return}
  if(req.url==='/__qa/script.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(dir,'bridge.js')));return}
  if(req.url==='/__qa/fixture'){res.end(JSON.stringify(fixture));return}
  if(req.url==='/__qa/command'){if(req.headers['x-vdoc-qa-owner']!=='print-capture-4188'){res.end('null');return}let c=null;try{c=JSON.parse(fs.readFileSync(path.join(dir,'command.json')))}catch{}if(c?.id===delivered)c=null;if(c)delivered=c.id;res.end(JSON.stringify(c));return}
  if(req.method==='POST'&&['/__qa/state','/__qa/ack'].includes(req.url)){let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>2e6){req.destroy();return}chunks.push(c)});req.on('end',()=>{const data=Buffer.concat(chunks);try{JSON.parse(data);fs.writeFileSync(path.join(dir,req.url.endsWith('state')?'state.json':'ack.json'),data);res.end('ok')}catch{res.writeHead(400);res.end()}});return}
  res.writeHead(404);res.end();return;
 }
 const up=http.request({hostname:'::1',port:5173,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:5173','accept-encoding':'identity'}},remote=>{
  if(remote.headers['content-type']?.includes('text/html')){let data=[];remote.on('data',c=>data.push(c));remote.on('end',()=>{let html=Buffer.concat(data).toString().replace('</head>','<script src="/__qa/script.js" defer></script></head>');let h={...remote.headers};delete h['content-length'];delete h['content-encoding'];res.writeHead(remote.statusCode,h);res.end(html)});
  }else{res.writeHead(remote.statusCode,remote.headers);remote.pipe(res)}
 });up.on('error',()=>{res.writeHead(502);res.end('Development server unavailable')});req.pipe(up);
});
server.on('upgrade',(req,socket,head)=>{const up=net.connect(5173,'::1',()=>{up.write(`${req.method} ${req.url} HTTP/1.1\r\n`+Object.entries({...req.headers,host:'localhost:5173'}).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');if(head.length)up.write(head);socket.pipe(up);up.pipe(socket)});up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy())});
server.listen(4188,'127.0.0.1',()=>console.log('Own Safari native QA origin: http://127.0.0.1:4188/'));
