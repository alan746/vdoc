const http=require('node:http'),fs=require('node:fs');
const file='output/pdf/safari-native-20261011/b-100.pdf';
http.createServer((req,res)=>{if(req.headers.host!=='127.0.0.1:4189'){res.writeHead(403);return res.end()}if(req.url==='/vdoc-fixed-pages.pdf'){res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});return fs.createReadStream(file).pipe(res)}res.writeHead(404);res.end()}).listen(4189,'127.0.0.1',()=>console.log('VDoc fixed PDF test: http://127.0.0.1:4189/vdoc-fixed-pages.pdf'));
