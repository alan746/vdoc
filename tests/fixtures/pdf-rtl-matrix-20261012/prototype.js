/* QA only: embedded TrueType/CIDFontType2 with explicit CID -> glyph/Unicode maps.
 * Three stream-order controls share exactly the same DOM and shaped positions.
 * No product integration, layout engine, raster text, or invisible overlay.
 */
window.makeType0Probe=async function(fontBytes,root,mode,mirroredBytes){
 if(mode!=='source-logical')throw Error('Unknown order');
 const {PDFDocument,PDFName,PDFHexString,beginText,endText,setFontAndSize,setTextMatrix}=PDFLib;
 const font=fontkit.create(new Uint8Array(fontBytes)),hf=new hb.Font(new hb.Face(new hb.Blob(fontBytes)));
 const pdf=await PDFDocument.create(),ctx=pdf.context,rect=root.getBoundingClientRect(),page=pdf.addPage([rect.width*.75,rect.height*.75]);
 const codes=[],lookup=new Map(),lines=[],targets=[],measurements=[];
 for(const line of root.querySelectorAll('.line')){
  const items=[];
  for(const [tokenIndex,el] of [...line.querySelectorAll('.token')].entries()){
   const text=el.firstChild.textContent,b=el.getBoundingClientRect(),size=parseFloat(getComputedStyle(el).fontSize),baseline=el.querySelector('i').getBoundingClientRect().top;
   const buffer=new hb.Buffer();buffer.addText(text);buffer.guessSegmentProperties();if(/^\d+$/u.test(text))buffer.setDirection(hb.Direction.LTR);hb.shape(hf,buffer);
   const shaped=buffer.getGlyphInfosAndPositions(),starts=[...new Set(shaped.map(g=>g.cluster))].sort((a,b)=>a-b);let pen=0;
   if(starts.length!==shaped.length)throw Error('Minimal probe requires one glyph per cluster: '+text+' '+JSON.stringify(shaped));
   for(const g of shaped){
    if(!g.codepoint)throw Error('Missing glyph');
    const end=starts[starts.indexOf(g.cluster)+1]??text.length,original=text.slice(g.cluster,end),annotated=mode==='source-annotated'&&line.dir==='rtl'&&g.cluster===0&&tokenIndex>0&&/^\s+$/.test(line.querySelectorAll('.token')[tokenIndex-1].firstChild.textContent),unicode=original+(annotated?' ':''),key=JSON.stringify([g.codepoint,unicode]);
    if(!lookup.has(key)){lookup.set(key,codes.length+1);codes.push({gid:g.codepoint,unicode,width:font.getGlyph(g.codepoint).advanceWidth/font.unitsPerEm*1000});}
    items.push({actualText:annotated?original:null,cid:lookup.get(key),x:b.left-rect.left+(pen+g.xOffset)/font.unitsPerEm*size,y:rect.bottom-baseline+g.yOffset/font.unitsPerEm*size,size,source:g.cluster,tokenIndex});pen+=g.xAdvance;
   }
   const delta=Math.abs(b.width-pen/font.unitsPerEm*size);if(delta>.12)throw Error('DOM/shape mismatch');measurements.push({text,delta});
   if(text.trim()){const range=document.createRange();range.selectNodeContents(el.firstChild);const r=range.getBoundingClientRect();targets.push({expected:text,x:r.x-rect.x+r.width/2,y:r.y-rect.y+r.height/2});}
  }
  if(mode==='source-logical')items.sort((a,b)=>a.tokenIndex-b.tokenIndex||a.source-b.source);
  if(mode==='page-visual')items.sort((a,b)=>a.x-b.x);
  lines.push(items);
 }
 const file=ctx.register(ctx.flateStream(new Uint8Array(mirroredBytes),{Length1:mirroredBytes.byteLength}));
 const mirrored=fontkit.create(new Uint8Array(mirroredBytes));const scale=1000/font.unitsPerEm;
 const descriptor=ctx.register(ctx.obj({Type:'FontDescriptor',FontName:'VDocQAEmbedded',Flags:4,FontBBox:[mirrored.bbox.minX*scale,mirrored.bbox.minY*scale,mirrored.bbox.maxX*scale,mirrored.bbox.maxY*scale],ItalicAngle:0,Ascent:font.ascent*scale,Descent:font.descent*scale,CapHeight:font.capHeight*scale,StemV:80,FontFile2:file}));
 const gidmap=new Uint8Array((codes.length+1)*2);codes.forEach((c,i)=>{gidmap[(i+1)*2]=c.gid>>8;gidmap[(i+1)*2+1]=c.gid&255});
 const descendant=ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType2',BaseFont:'VDocQAEmbedded',CIDSystemInfo:{Registry:PDFLib.PDFString.of('Adobe'),Ordering:PDFLib.PDFString.of('Identity'),Supplement:0},FontDescriptor:descriptor,DW:1000,W:[1,codes.map(c=>c.width)],CIDToGIDMap:ctx.register(ctx.flateStream(gidmap))}));
 const hex=s=>Array.from({length:s.length},(_,i)=>s.charCodeAt(i).toString(16).padStart(4,'0')).join('');
 const cmap=codes.map((c,i)=>`<${(i+1).toString(16).padStart(4,'0')}> <${hex(c.unicode)}>`);
 const mappings=[];for(let i=0;i<cmap.length;i+=100){const group=cmap.slice(i,i+100);mappings.push(`${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`);}
 const unicode=ctx.register(ctx.flateStream(`/CIDInit /ProcSet findresource begin\n12 dict begin begincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /VDocQA def /CMapType 2 def\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n${mappings.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`));
 const type0=ctx.register(ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:'VDocQAEmbedded',Encoding:'Identity-H',DescendantFonts:[descendant],ToUnicode:unicode}));
 const name=page.node.newFontDictionary('QAEmbedded',type0);
 for(const items of lines){
  for(const item of items)item.x+=codes[item.cid-1].width/1000*item.size;const first=items[0];page.pushOperators(beginText(),setFontAndSize(name,first.size*.75),setTextMatrix(-1,0,0,1,first.x*.75,first.y*.75));let pen=first.x;const parts=[];const flush=()=>{if(parts.length){page.pushOperators(PDFLib.PDFOperator.of('TJ',[ctx.obj([...parts])]));parts.length=0;}};
  for(const item of items){if(item.size!==first.size||Math.abs(item.y-first.y)>.01)throw Error('Minimal probe only supports constant baseline and size');const delta=(item.x-pen)/item.size*1000;if(Math.abs(delta)>.00001)parts.push(delta);if(item.actualText){flush();page.pushOperators(PDFLib.PDFOperator.of('BDC',[PDFName.of('Span'),ctx.obj({ActualText:PDFHexString.fromText(item.actualText)})]));}parts.push(PDFHexString.of(item.cid.toString(16).padStart(4,'0')));if(item.actualText){flush();page.pushOperators(PDFLib.PDFOperator.of('EMC'));}pen=item.x-codes[item.cid-1].width/1000*item.size;}
  flush();page.pushOperators(endText());
 }
 return {bytes:[...await pdf.save()],sourceText:root.innerText,targets,measurements,codes,lines,mode};
};
