const http=require('node:http'),fs=require('node:fs');
const file='output/pdf/pdf-prefont-20261011/flow-fallback-contextual.pdf';
http.createServer((req,res)=>{if(req.headers.host!=='127.0.0.1:4189'){res.writeHead(403);return res.end()}if(req.url==='/vdoc-flow-contextual.pdf'){const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':data.length,'Cache-Control':'no-store'});return res.end(data)}res.writeHead(404);res.end()}).listen(4189,'127.0.0.1',()=>console.log('Owned VDoc Unicode PDF server ready'));
