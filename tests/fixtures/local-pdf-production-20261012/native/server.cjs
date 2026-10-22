const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const dir=__dirname,bytes=fs.readFileSync(path.join(dir,'../browser-download-verified.pdf'));
const server=http.createServer((req,res)=>{if(req.url!=='/vdoc-production-print.pdf'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes)});
server.listen(0,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}/vdoc-production-print.pdf`;fs.writeFileSync(path.join(dir,'server.json'),JSON.stringify({url,pid:process.pid}));console.log(url)});
