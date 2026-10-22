/* QA-only whole-cluster line encoding experiment. Not a production font strategy. */
window.buildUnicodePdf = async function ({fontBytes, root, signal}) {
 const actualText='line'; // one positioned line object, source token order
 const fail=()=>{if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');};fail();
 const {PDFDocument,PDFName,PDFHexString,beginText,endText,setFontAndSize,setTextMatrix,showText,rgb}=PDFLib;
 const font=fontkit.create(new Uint8Array(fontBytes)),hbFont=new hb.Font(new hb.Face(new hb.Blob(fontBytes))),pdf=await PDFDocument.create();
 const rect=root.getBoundingClientRect(),page=pdf.addPage([rect.width*.75,rect.height*.75]),ctx=pdf.context;
 const tokens=[...root.querySelectorAll('.token')];if(tokens.length>2000)throw Error('QA token bound exceeded');
 const words=[...new Set(tokens.map(el=>el.firstChild.textContent))];if(words.length>255)throw Error('QA word-font capacity exceeded');
 const chars={},widths=[],cmap=[],runs=new Map();let minX=0,maxWidth=0,minY=0,maxY=0;const measurements=[];
 const n=x=>Number(x.toFixed(5)),clusters=[];
 for(let i=0;i<words.length;i++){
  const text=words[i],buffer=new hb.Buffer();buffer.addText(text);buffer.guessSegmentProperties();hb.shape(hbFont,buffer);
  const shaped=buffer.getGlyphInfosAndPositions(),ends=[...new Set(shaped.map(g=>g.cluster))].sort((a,b)=>a-b);
  const groups=[];let x=0;
  for(const glyph of shaped){let group=groups.at(-1);if(!group||group.index!==glyph.cluster){group={index:glyph.cluster,x,width:0,glyphs:[],positions:[]};groups.push(group);}
   group.glyphs.push(font.getGlyph(glyph.codepoint));group.positions.push(glyph);group.width+=glyph.xAdvance;x+=glyph.xAdvance;
  }
  const output=[];for(const group of groups){const end=ends[ends.indexOf(group.index)+1]??text.length;const original=text.slice(group.index,end);
   const entry={text:original,glyphs:group.glyphs,positions:group.positions};const key=JSON.stringify([original,group.glyphs.map(g=>g.id),group.positions.map(g=>[g.xAdvance,g.yAdvance,g.xOffset,g.yOffset])]);
   let index=clusters.findIndex(c=>c.key===key);if(index<0){index=clusters.length;clusters.push({...entry,key});}output.push({code:index+1,x:group.x,sourceStart:group.index});
  }runs.set(text,{width:x,clusters:output});
 }
 // Keep one semantic entry per shaped cluster. Source token order and
 // visual cluster placement are separate, as in the previous line experiment.
 if(clusters.length>255)throw Error('QA cluster font capacity exceeded');
 for(let i=0;i<clusters.length;i++){
  if(i%16===0)await new Promise(resolve=>setTimeout(resolve,0));
  fail();const run=clusters[i],text=run.text;if(!text||text.length>128)throw Error('Unsupported QA cluster');if(run.glyphs.some(g=>g.id===0))throw Error('Missing glyph: '+text);
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
  const mappedText=/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text)?[...text].reverse().join(''):text;
  let hex='';for(let j=0;j<mappedText.length;j++)hex+=mappedText.charCodeAt(j).toString(16).padStart(4,'0');
  cmap.push(`<${code.toString(16).padStart(2,'0')}> <${hex}>`);
 }
 const mappings=[];for(let i=0;i<cmap.length;i+=100){const part=cmap.slice(i,i+100);mappings.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);}
 const unicode=ctx.register(ctx.flateStream('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /VDocQAWordUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'+mappings.join('\n')+'\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'));
 const differences=[1,...clusters.map((_,i)=>PDFName.of('w'+(i+1)))];
 const type3=ctx.register(ctx.obj({Type:'Font',Subtype:'Type3',FontBBox:[minX,minY,maxWidth,maxY],FontMatrix:[1/font.unitsPerEm,0,0,1/font.unitsPerEm,0,0],CharProcs:chars,Encoding:{Type:'Encoding',Differences:differences},FirstChar:1,LastChar:clusters.length,Widths:widths,Resources:{},ToUnicode:unicode}));
 const fontName=page.node.newFontDictionary('QAWord',type3);
 for(const cell of root.querySelectorAll('td')){const b=cell.getBoundingClientRect();page.drawRectangle({x:(b.x-rect.x)*.75,y:(rect.bottom-b.bottom)*.75,width:b.width*.75,height:b.height*.75,borderWidth:.5,borderColor:rgb(.65,.68,.74),color:rgb(.98,.98,.99)});}
 const blocks=[...new Set(tokens.map(el=>el.parentElement))];
 for(const block of blocks){
  const blockTokens=tokens.filter(el=>el.parentElement===block);
  blockTokens.sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
  const baselineY=blockTokens[0].querySelector('.baseline').getBoundingClientRect().top;
  if(blockTokens.some(el=>Math.abs(el.querySelector('.baseline').getBoundingClientRect().top-baselineY)>.1))throw Error('QA wrapped blocks are unsupported');
  // Source token order, HarfBuzz visual glyph order within each token.
  if(actualText===true)page.pushOperators(PDFLib.PDFOperator.of('BDC',[PDFName.of('Span'),ctx.obj({ActualText:PDFHexString.fromText(block.textContent)})]));
  page.pushOperators(beginText());let pen=null,lastSize=null;const lineParts=[];
 for(const el of blockTokens){
  fail();const text=el.firstChild.textContent,run=runs.get(text),b=el.getBoundingClientRect(),baseline=el.querySelector('.baseline').getBoundingClientRect().top,style=getComputedStyle(el),size=parseFloat(style.fontSize),expected=run.width/font.unitsPerEm*size;
  if(style.fontWeight!=='400'||style.fontStyle!=='normal')throw Error('Unsupported QA font style');
  if(b.left<rect.left-.1||b.right>rect.right+.1||b.top<rect.top-.1||b.bottom>rect.bottom+.1)throw Error('QA content exceeds page bounds');
  const delta=Math.abs(b.width-expected);measurements.push({text,domWidth:b.width,fontWidth:expected,delta});if(delta>.12)throw Error('Browser/font shaper width mismatch: '+text+' '+delta);
  if(['line','string'].includes(actualText)&&lastSize!==null&&lastSize!==size)throw Error('Mixed-size QA line unsupported');
  if(lastSize!==size)page.pushOperators(setFontAndSize(fontName,size*.75));lastSize=size;
  for(const item of run.clusters){
   const hasOutline=clusters[item.code-1].glyphs.length>0;
   const target=b.x+item.x/font.unitsPerEm*size;
   if(pen===null){page.pushOperators(setTextMatrix(1,0,0,1,(target-rect.x)*.75,(rect.bottom-baseline)*.75));pen=target;}
   if(hasOutline){const adjustment=-(target-pen)/size*1000;if(Math.abs(adjustment)>0.00001)lineParts.push(adjustment);pen=target+widths[item.code-1]/font.unitsPerEm*size;}
   const hex=item.code.toString(16).padStart(2,'0');const last=lineParts.at(-1);
   if(last&&typeof last!=='number')lineParts[lineParts.length-1]=PDFHexString.of(last.asString()+hex);
   else lineParts.push(PDFHexString.of(hex));
  }

 }
  if(actualText==='line')page.pushOperators(PDFLib.PDFOperator.of('TJ',[ctx.obj(lineParts)]));
  if(actualText==='string')page.pushOperators(showText(PDFHexString.of(lineParts.filter(part=>typeof part!=='number').map(part=>part.asString()).join(''))));
  page.pushOperators(endText());
  if(actualText===true)page.pushOperators(PDFLib.PDFOperator.of('EMC'));
 }
 fail();const bytes=await pdf.save();fail();return {bytes,report:{prototypeOnly:true,pages:1,tokens:tokens.length,uniqueWords:words.length,uniqueClusters:clusters.length,measurements,scope:'Regular-weight cluster-level selection, QA single-page layout only. One shaped cluster maps to its full Unicode sequence; no codepoint decomposition. QA only, selection acceptance pending.'}};
};
