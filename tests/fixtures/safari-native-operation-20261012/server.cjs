// QA only: owned fresh loopback origin; fixed commands, no arbitrary evaluation.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve('tests/fixtures/safari-native-operation-20261012');
const token=crypto.randomBytes(24).toString('hex'),prefix='/__qa/'+token;
let origin='',delivered='';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/safari-preview/source.vdoc.json'));
fixture.title='QA native operation guard 20261012';
const server=http.createServer((req,res)=>{
 if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
 if(req.url.startsWith('/__qa/')){
  if(!req.url.startsWith(prefix+'/')){res.writeHead(404);res.end();return;}
  if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');
  const route=req.url.slice(prefix.length);
  if(req.method==='GET'&&route==='/bridge.js'){res.setHeader('Content-Type','text/javascript');res.end('const qaPrefix='+JSON.stringify(prefix)+';\n'+fs.readFileSync(path.join(dir,'bridge.js'),'utf8'));return;}
  if(req.method==='GET'&&route==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}
  if(req.method==='GET'&&route==='/command'){
   let c=null;try{c=JSON.parse(fs.readFileSync(path.join(dir,'command.json')))}catch{}
   if(c?.id===delivered)c=null;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(c));return;
  }
  if(req.method==='POST'&&['/state','/ack'].includes(route)){
   let chunks=[],size=0;req.on('data',c=>{size+=c.length;if(size>2e6){req.destroy();return;}chunks.push(c)});
   req.on('end',()=>{try{const data=Buffer.concat(chunks),parsed=JSON.parse(data);if(route==='/ack')delivered=parsed.id;fs.writeFileSync(path.join(dir,route==='/state'?'state.json':'ack.json'),data);res.end('ok')}catch{res.writeHead(400);res.end()}});return;
  }
  res.writeHead(404);res.end();return;
 }
 const upstream=http.request({hostname:'127.0.0.1',port:4187,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:4187','accept-encoding':'identity'}},remote=>{
  if(remote.headers['content-type']?.includes('text/html')){
   const chunks=[];remote.on('data',c=>chunks.push(c));remote.on('end',()=>{
    const body=Buffer.concat(chunks).toString().replace('</head>',`<script src="${prefix}/bridge.js" defer></script></head>`);
    const headers={...remote.headers};delete headers['content-length'];delete headers['content-encoding'];res.writeHead(remote.statusCode,headers);res.end(body);
   });
  }else{res.writeHead(remote.statusCode,remote.headers);remote.pipe(res)}
 });
 upstream.on('error',()=>{res.writeHead(502);res.end('QA production server unavailable')});req.pipe(upstream);
});
server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;fs.writeFileSync(path.join(dir,'server.json'),JSON.stringify({origin,prefix,pid:process.pid}));console.log(origin)});
