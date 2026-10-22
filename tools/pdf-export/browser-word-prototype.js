/* QA only. Whole-word Type3 vector glyphs preserve each word's source Unicode.
 * Requires PDFLib + fontkit browser globals and explicit font bytes. Not an
 * arbitrary DOM exporter; no production button imports this experiment.
 */
window.buildWordPdf = async function ({fontBytes, root, signal}) {
 const fail=()=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};fail();
 const {PDFDocument,PDFName,PDFHexString,beginText,endText,setFontAndSize,setTextMatrix,showText,rgb}=PDFLib;
 const font=fontkit.create(new Uint8Array(fontBytes)),pdf=await PDFDocument.create();
 const rect=root.getBoundingClientRect(),page=pdf.addPage([rect.width*.75,rect.height*.75]),ctx=pdf.context;
 const tokens=[...root.querySelectorAll('.token')];if(tokens.length>2000)throw Error('QA token bound exceeded');
 const words=[...new Set(tokens.map(el=>el.firstChild.textContent))];if(words.length>255)throw Error('QA word-font capacity exceeded');
 const chars={},widths=[],cmap=[],runs=new Map();let minX=0,maxWidth=0,minY=0,maxY=0;const measurements=[];
 const n=x=>Number(x.toFixed(5));
 for(let i=0;i<words.length;i++){
  if(i%16===0)await new Promise(resolve=>setTimeout(resolve,0));
  fail();const text=words[i];if(!text||text.length>128)throw Error('Unsupported QA word');
  const run=font.layout(text);if(run.glyphs.some(g=>g.id===0))throw Error('Missing glyph: '+text);
  let penX=0,penY=0;const paths=[];let x0=0,y0=0,x1=0,y1=0;
  run.glyphs.forEach((glyph,j)=>{
   const p=run.positions[j],ox=penX+p.xOffset,oy=penY+p.yOffset,b=glyph.bbox;
   x0=Math.min(x0,b.minX+ox);y0=Math.min(y0,b.minY+oy);x1=Math.max(x1,b.maxX+ox);y1=Math.max(y1,b.maxY+oy);
   let cx=0,cy=0;
   for(const command of glyph.path.commands){
    const a=command.args,pt=(x,y)=>`${n(x+ox)} ${n(y+oy)}`;
    if(command.command==='moveTo'){paths.push(pt(a[0],a[1])+' m');[cx,cy]=a;}
    else if(command.command==='lineTo'){paths.push(pt(a[0],a[1])+' l');[cx,cy]=a;}
    else if(command.command==='quadraticCurveTo'){
     paths.push(pt(cx+2*(a[0]-cx)/3,cy+2*(a[1]-cy)/3)+' '+pt(a[2]+2*(a[0]-a[2])/3,a[3]+2*(a[1]-a[3])/3)+' '+pt(a[2],a[3])+' c');[cx,cy]=a.slice(2);
    }else if(command.command==='bezierCurveTo'){paths.push(pt(a[0],a[1])+' '+pt(a[2],a[3])+' '+pt(a[4],a[5])+' c');[cx,cy]=a.slice(4);}
    else if(command.command==='closePath')paths.push('h');else throw Error('Unsupported path command '+command.command);
   }
   paths.push('f');penX+=p.xAdvance;penY+=p.yAdvance;
  });
  const code=i+1,key='w'+code,stream=`${n(penX)} 0 ${n(x0)} ${n(y0)} ${n(x1)} ${n(y1)} d1\n`+paths.join('\n');
  chars[key]=ctx.register(ctx.flateStream(stream));widths.push(penX);minX=Math.min(minX,x0);maxWidth=Math.max(maxWidth,x1);minY=Math.min(minY,y0);maxY=Math.max(maxY,y1);
  let hex='';for(let j=0;j<text.length;j++)hex+=text.charCodeAt(j).toString(16).padStart(4,'0');
  cmap.push(`<${code.toString(16).padStart(2,'0')}> <${hex}>`);runs.set(text,{code,width:penX,fontGlyphs:run.glyphs.length});
 }
 const mappings=[];for(let i=0;i<cmap.length;i+=100){const part=cmap.slice(i,i+100);mappings.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);}
 const unicode=ctx.register(ctx.flateStream('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /VDocQAWordUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'+mappings.join('\n')+'\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'));
 const differences=[1,...words.map((_,i)=>PDFName.of('w'+(i+1)))];
 const type3=ctx.register(ctx.obj({Type:'Font',Subtype:'Type3',FontBBox:[minX,minY,maxWidth,maxY],FontMatrix:[1/font.unitsPerEm,0,0,1/font.unitsPerEm,0,0],CharProcs:chars,Encoding:{Type:'Encoding',Differences:differences},FirstChar:1,LastChar:words.length,Widths:widths,Resources:{},ToUnicode:unicode}));
 const fontName=page.node.newFontDictionary('QAWord',type3);
 for(const cell of root.querySelectorAll('td')){const b=cell.getBoundingClientRect();page.drawRectangle({x:(b.x-rect.x)*.75,y:(rect.bottom-b.bottom)*.75,width:b.width*.75,height:b.height*.75,borderWidth:.5,borderColor:rgb(.65,.68,.74),color:rgb(.98,.98,.99)});}
 for(const el of tokens){
  fail();const text=el.firstChild.textContent,run=runs.get(text),b=el.getBoundingClientRect(),baseline=el.querySelector('.baseline').getBoundingClientRect().top,style=getComputedStyle(el),size=parseFloat(style.fontSize),expected=run.width/font.unitsPerEm*size;
  if(style.fontWeight!=='400'||style.fontStyle!=='normal')throw Error('Unsupported QA font style');
  if(b.left<rect.left-.1||b.right>rect.right+.1||b.top<rect.top-.1||b.bottom>rect.bottom+.1)throw Error('QA content exceeds page bounds');
  const delta=Math.abs(b.width-expected);measurements.push({text,domWidth:b.width,fontWidth:expected,delta});if(delta>.12)throw Error('Browser/font shaper width mismatch: '+text+' '+delta);
  page.pushOperators(beginText(),setFontAndSize(fontName,size*.75),setTextMatrix(1,0,0,1,(b.x-rect.x)*.75,(rect.bottom-baseline)*.75),showText(PDFHexString.of(run.code.toString(16).padStart(2,'0'))),endText());
 }
 fail();const bytes=await pdf.save();fail();return {bytes,report:{prototypeOnly:true,pages:1,tokens:tokens.length,uniqueWords:words.length,measurements,scope:'Regular-weight word-level selection, QA single-page layout only. No invisible text, raster fallback or post-export repair.'}};
};
