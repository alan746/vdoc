/* QA-only nonzero semantic advances for marked grapheme records; independent visible ink. Not a production font strategy. */
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
  const text=words[i],buffer=new hb.Buffer();buffer.addText(text);buffer.guessSegmentProperties();if(/^\p{Nd}+$/u.test(text))buffer.setDirection(hb.Direction.LTR);hb.shape(hbFont,buffer);
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
 // QA diagnostic: one Unicode code point per encoded glyph. A shaped cluster's
 // first non-mark record carries the visible outline/advance; continuations have no outline
 // and zero advance. This is a semantic decomposition experiment, NOT a shipped
 // font strategy; selection and reprint must be checked independently.
 const originalClusters=clusters.splice(0),codes=[];
 for(const cluster of originalClusters){
  const characters=[...cluster.text];let sourceOffset=0;
  const outlineIndex=Math.max(0,characters.findIndex(char=>!/[\p{Mn}\p{Cf}]/u.test(char)));
  const entries=[];for(const [index,character] of characters.entries()){
   entries.push({code:clusters.length+1,sourceOffset,annotationStart:characters.length>1&&!/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(cluster.text)&&index===0?cluster.text:null,annotationEnd:characters.length>1&&!/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(cluster.text)&&index===characters.length-1});sourceOffset+=character.length;clusters.push({...cluster,text:character,
    glyphs:index===outlineIndex?cluster.glyphs:[],positions:index===outlineIndex?cluster.positions:[]});
  }codes.push(entries);
 }
 for(const [word,run] of runs){
  run.clusters=run.clusters.flatMap(c=>codes[c.code-1].map(item=>({...item,x:c.x,sourceStart:c.sourceStart+item.sourceOffset})));
  if(/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(word)){
   run.clusters.sort((a,b)=>a.sourceStart-b.sourceStart);
   const isR=item=>/\p{L}/u.test(clusters[item.code-1].text)&&/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(clusters[item.code-1].text);
   for(let start=0;start<run.clusters.length;){
    if(!isR(run.clusters[start])){start++;continue;}
    let end=start+1;while(end<run.clusters.length&&isR(run.clusters[end]))end++;
    run.clusters.splice(start,end-start,...run.clusters.slice(start,end).reverse());start=end;
   }
  }
 }
 // QA only: retain the established codepoint order and advances, but measure
 // independent semantic boxes. Paint RTL outlines separately so hit boxes never clip ink.
 const hitMeasurements=[];
 for(const [word,run] of runs){
  const numeric=/^\p{Nd}+$/u.test(word);
  const markedWord=/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(word)&&/[\p{Mn}\p{Mc}]/u.test(word);
  if(!numeric&&!markedWord&&!/\p{Script=Arabic}/u.test(word))continue;
  const el=tokens.find(el=>el.firstChild.textContent===word),b=el.getBoundingClientRect();
  const baseline=el.querySelector('.baseline').getBoundingClientRect().top,size=parseFloat(getComputedStyle(el).fontSize),scale=font.unitsPerEm/size;
  const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word)];
  let pen=null;
  run.clusters=run.clusters.map(item=>{
   const original=clusters[item.code-1],outline=original.glyphs.length>0;
   if(pen===null&&!outline)throw Error('QA initial empty RTL record unsupported');
   if(outline)pen=item.x;
   const origin=pen;
   const segment=segments.find(s=>item.sourceStart>=s.index&&item.sourceStart<s.index+s.segment.length);
   // Keep natural ink geometry for an unmarked final grapheme: extending it
   // to the full advance would include the adjacent inter-word gap.
   const naturalTerminal=markedWord&&segment.index+segment.segment.length===word.length&&!/[\p{Mn}\p{Mc}]/u.test(segment.segment);
   if(naturalTerminal||(numeric&&item.sourceStart+original.text.length!==word.length)||(!numeric&&!markedWord&&!['ا','ل'].includes(original.text))){if(outline)pen+=original.positions.reduce((sum,p)=>sum+p.xAdvance,0);return item;}
   const range=document.createRange();range.setStart(el.firstChild,segment.index);range.setEnd(el.firstChild,segment.index+segment.segment.length);const r=range.getBoundingClientRect();
   const characters=[...segment.segment],slot=[...segment.segment.slice(0,item.sourceStart-segment.index)].length;
   const width=r.width/characters.length,left=r.left+width*(numeric?slot:characters.length-1-slot);
   const semanticAdvance=markedWord&&/[\p{Mn}\p{Mc}]/u.test(segment.segment)?width*scale:null;
   const semanticOrigin=semanticAdvance!==null?(left-b.left)*scale:origin;
   const box=[(left-b.left)*scale-semanticOrigin,(baseline-r.bottom)*scale,(left+width-b.left)*scale-semanticOrigin,(baseline-r.top)*scale];
   if(!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])throw Error('Invalid semantic hit box');
   clusters.push({...original,semanticBox:box,semanticAdvance});
   hitMeasurements.push({word,text:original.text,sourceStart:item.sourceStart,box,origin});
   if(outline)pen+=original.positions.reduce((sum,p)=>sum+p.xAdvance,0);
   return {...item,code:clusters.length,semanticX:semanticAdvance!==null?semanticOrigin:undefined};
  });
 }
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
  const code=i+1,key='w'+code;
  if(run.semanticBox&&paths.length){run.paint=page.node.newXObject('QAInk',ctx.register(ctx.flateStream(paths.join('\n'),{Type:'XObject',Subtype:'Form',FormType:1,BBox:[x0-1,y0-1,x1+1,y1+1],Resources:{}})));}
  const semantic=run.semanticBox||[x0,y0,x1,y1];const advance=run.semanticAdvance??penX;const stream=`${n(advance)} 0 ${semantic.map(n).join(' ')} d1\n`+(run.semanticBox?'':paths.join('\n'));
  chars[key]=ctx.register(ctx.flateStream(stream));widths.push(advance);minX=Math.min(minX,semantic[0]);maxWidth=Math.max(maxWidth,semantic[2]);minY=Math.min(minY,semantic[1]);maxY=Math.max(maxY,semantic[3]);
  let hex='';for(let j=0;j<text.length;j++)hex+=text.charCodeAt(j).toString(16).padStart(4,'0');
  cmap.push(`<${code.toString(16).padStart(2,'0')}> <${hex}>`);
 }
 const mappings=[];for(let i=0;i<cmap.length;i+=100){const part=cmap.slice(i,i+100);mappings.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);}
 const unicode=ctx.register(ctx.flateStream('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /VDocQAWordUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'+mappings.join('\n')+'\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'));
 const differences=[1,...clusters.map((_,i)=>PDFName.of('w'+(i+1)))];
 const type3=ctx.register(ctx.obj({Type:'Font',Subtype:'Type3',FontBBox:[minX,minY,maxWidth,maxY],FontMatrix:[1/font.unitsPerEm,0,0,1/font.unitsPerEm,0,0],CharProcs:chars,Encoding:{Type:'Encoding',Differences:differences},FirstChar:1,LastChar:clusters.length,Widths:widths,Resources:{},ToUnicode:unicode}));
 const fontName=page.node.newFontDictionary('QAWord',type3);
 for(const cell of root.querySelectorAll('td')){const b=cell.getBoundingClientRect();page.drawRectangle({x:(b.x-rect.x)*.75,y:(rect.bottom-b.bottom)*.75,width:b.width*.75,height:b.height*.75,borderWidth:.5,borderColor:rgb(.65,.68,.74),color:rgb(.98,.98,.99)});}
 for(const el of tokens){const run=runs.get(el.firstChild.textContent),b=el.getBoundingClientRect(),baseline=el.querySelector('.baseline').getBoundingClientRect().top,size=parseFloat(getComputedStyle(el).fontSize),scale=size*.75/font.unitsPerEm;
  for(const item of run.clusters){const glyph=clusters[item.code-1];if(glyph.paint)page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(scale,0,0,scale,(b.left-rect.left)*.75+item.x*scale,(rect.bottom-baseline)*.75),PDFLib.drawObject(glyph.paint),PDFLib.popGraphicsState());}
 }
 const blocks=[...new Set(tokens.map(el=>el.parentElement))];
 for(const block of blocks){
  const blockTokens=tokens.filter(el=>el.parentElement===block);
  const baselineY=blockTokens[0].querySelector('.baseline').getBoundingClientRect().top;
  if(blockTokens.some(el=>Math.abs(el.querySelector('.baseline').getBoundingClientRect().top-baselineY)>.1))throw Error('QA wrapped blocks are unsupported');
  // Source token order, HarfBuzz visual glyph order within each token.
  if(actualText===true)page.pushOperators(PDFLib.PDFOperator.of('BDC',[PDFName.of('Span'),ctx.obj({ActualText:PDFHexString.fromText(block.textContent)})]));
  page.pushOperators(beginText());let pen=null,lastSize=null;const lineParts=[];const flush=()=>{if(lineParts.length){page.pushOperators(PDFLib.PDFOperator.of('TJ',[ctx.obj([...lineParts])]));lineParts.length=0;}};
 for(const el of blockTokens){
  fail();const text=el.firstChild.textContent,run=runs.get(text),b=el.getBoundingClientRect(),baseline=el.querySelector('.baseline').getBoundingClientRect().top,style=getComputedStyle(el),size=parseFloat(style.fontSize),expected=run.width/font.unitsPerEm*size;
  if(style.fontWeight!=='400'||style.fontStyle!=='normal')throw Error('Unsupported QA font style');
  if(b.left<rect.left-.1||b.right>rect.right+.1||b.top<rect.top-.1||b.bottom>rect.bottom+.1)throw Error('QA content exceeds page bounds');
  const delta=Math.abs(b.width-expected);measurements.push({text,domWidth:b.width,fontWidth:expected,delta});if(delta>.12)throw Error('Browser/font shaper width mismatch: '+text+' '+delta);
  if(['line','string'].includes(actualText)&&lastSize!==null&&lastSize!==size)throw Error('Mixed-size QA line unsupported');
  if(lastSize!==size)page.pushOperators(setFontAndSize(fontName,size*.75));lastSize=size;
  for(const item of run.clusters){
   const hasOutline=clusters[item.code-1].glyphs.length>0||item.semanticX!==undefined;
   const target=b.x+(item.semanticX??item.x)/font.unitsPerEm*size;
   if(pen===null){page.pushOperators(setTextMatrix(1,0,0,1,(target-rect.x)*.75,(rect.bottom-baseline)*.75));pen=target;}
   if(hasOutline){const adjustment=-(target-pen)/size*1000;if(Math.abs(adjustment)>0.00001)lineParts.push(adjustment);pen=target+widths[item.code-1]/font.unitsPerEm*size;}
   if(item.annotationStart){flush();page.pushOperators(PDFLib.PDFOperator.of('BDC',[PDFName.of('Span'),ctx.obj({ActualText:PDFHexString.fromText(item.annotationStart)})]));}
   const hex=item.code.toString(16).padStart(2,'0');const last=lineParts.at(-1);
   if(last&&typeof last!=='number')lineParts[lineParts.length-1]=PDFHexString.of(last.asString()+hex);
   else lineParts.push(PDFHexString.of(hex));
   if(item.annotationEnd){flush();page.pushOperators(PDFLib.PDFOperator.of('EMC'));}
  }

 }
  if(actualText==='line')flush();
  if(actualText==='string')page.pushOperators(showText(PDFHexString.of(lineParts.filter(part=>typeof part!=='number').map(part=>part.asString()).join(''))));
  page.pushOperators(endText());
  if(actualText===true)page.pushOperators(PDFLib.PDFOperator.of('EMC'));
 }
 fail();const bytes=await pdf.save();fail();return {bytes,report:{prototypeOnly:true,hitMeasurements,pages:1,tokens:tokens.length,uniqueWords:words.length,uniqueClusters:clusters.length,measurements,scope:'Regular-weight cluster-level selection, QA single-page layout only. Codepoint records retained; local ActualText encloses each non-RTL multi-codepoint shaped cluster. Alef/lam in unmarked Arabic words and the terminal codepoint of decimal-only tokens receive independent hit boxes and separated ink. Pure decimal tokens are shaped LTR explicitly; nonterminal digits retain original glyph geometry. Marked Arabic/Hebrew words receive DOM-measured grapheme slots, except unmarked final graphemes which retain natural glyph geometry. Marked grapheme records use positive semantic slot advances and explicit text positions, with visible vector paint unchanged. Other codepoints retain the previous representation. QA only; independent reader and geometry acceptance required.'}};
};
