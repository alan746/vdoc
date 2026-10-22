from pathlib import Path
import subprocess,time,json,sys,hashlib
base=Path(__file__).resolve().parent;root=base.parents[2];out=root/'output/pdf/webkit-print-viewport-20261011'
mode=sys.argv[1];pct=int(sys.argv[2]);assert mode in ['short','fixed-mm','viewport'] and pct in [93,99,100,101,102]
name=f'{mode}-{pct}';pdf=out/(name+'.pdf');assert not pdf.exists()
with (base/(name+'.stdout')).open('w') as stdout,(base/(name+'.stderr')).open('w') as stderr:
 p=subprocess.Popen(['/tmp/vdoc-print-viewport-qa',str(base/(mode+'.html')),str(pdf),str(pct/100)],stdout=stdout,stderr=stderr)
 deadline=time.monotonic()+20;reason=None
 while p.poll() is None:
  if pdf.exists() and pdf.stat().st_size>2_000_000:reason='2 MB output cap exceeded';break
  if time.monotonic()>deadline:reason='20 second native probe limit';break
  time.sleep(.1)
 if reason:p.kill()
 code=p.wait(timeout=5)
report={'mode':mode,'scale':pct,'exit':code,'stoppedReason':reason,'fileExists':pdf.exists()}
if pdf.exists():
 report.update(bytes=pdf.stat().st_size,sha256=hashlib.sha256(pdf.read_bytes()).hexdigest())
 if reason:pdf.unlink();report['incompleteTemporaryOutputRemoved']=True
(base/(name+'.run.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));print((base/(name+'.stdout')).read_text()[-3000:]);print((base/(name+'.stderr')).read_text()[-1500:])
if code:sys.exit(1)
