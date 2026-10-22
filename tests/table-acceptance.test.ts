import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { CellSelection } from '@tiptap/pm/tables';
import { tableContextSelection } from '../lib/editor/table/table-context-selection';
import { colorToHex } from '../lib/domain/text/color';
import { cellBorder, borderSides } from '../lib/editor/table/table-borders';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { distributeColumnWidths, tableColumnWidths, tablePropertyOperations, type CellProperties } from '../lib/editor/table/table-properties';
let editor: Editor, engine: DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<p>Before</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
const table = () => { let found: typeof editor.state.doc | undefined;editor.state.doc.descendants(n=>{if(n.type.name==='table')found=n;});return found!; };
const target = (row=0,col=0,endRow=row,endCol=col) => ({kind:'cells',tableId:engine.snapshot().blocks.find(b=>b.type==='table')!.id,row,col,endRow,endCol});
it.each([[1,1],[20,20],[30,20]])('inserts %i by %i cells, preserves backup and undoes exactly', (rows,cols)=>{
  const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'table.insert',rows,cols}]}).ok).toBe(true);
  const map=TableMap.get(table());expect([map.height,map.width,map.problems]).toEqual([rows,cols,null]);
  const saved=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:'Table',content:saved})).content).toEqual(saved);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('rejects oversized insertion atomically',()=>{
  const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'text.insert',text:'Must not appear'},{type:'table.insert',rows:21,cols:21}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});
it('preserves all contiguous header rows when sorting data rows numerically',()=>{
  editor.commands.setContent('<table><tr><th>Main header</th></tr><tr><th>Units</th></tr><tr><td>20</td></tr><tr><td>3</td></tr><tr><td>10</td></tr></table>');
  const before=editor.getJSON();expect(engine.execute({target:target(2,0),operations:[{type:'table.sort',column:0}]}).ok).toBe(true);
  expect(Array.from({length:table().childCount},(_,i)=>table().child(i).textContent)).toEqual(['Main header','Units','3','10','20']);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it.each(['rowAfter','columnAfter','deleteRow','deleteColumn'])('keeps merged table valid during %s and restores exact content',action=>{
  editor.commands.setContent('<table><tr><td colspan="2">Merged</td><td>C</td></tr><tr><td rowspan="2">A</td><td>B</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></table>');
  const before=editor.getJSON();expect(engine.execute({target:target(1,1),operations:[{type:'table.edit',action}]}).ok).toBe(true);
  expect(TableMap.get(table()).problems).toBeNull();engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('preserves table and unselected column widths when distributing a region',()=>{
  expect(distributeColumnWidths([100,200,300])).toEqual([200,200,200]);
  expect(distributeColumnWidths([100,201,300],1,3)).toEqual([100,251,250]);
});
it('resolves widths below a merged header, and does not edit unchanged or mixed fields',()=>{
  editor.commands.setContent('<table><tr><th colspan="3">Header</th></tr><tr><td colwidth="100">A</td><td colwidth="200">B</td><td colwidth="300">C</td></tr></table>');
  expect(tableColumnWidths(table())).toEqual([100,200,300]);
  const before: CellProperties={width:100,padding:8,borderWidth:2,borderColor:'#222222',minHeight:0,verticalAlign:'top'};
  expect(tablePropertyOperations(before,{...before},[100,200,300],0,1)).toEqual([]);
  const operations=tablePropertyOperations(before,{...before,padding:16},[100,200,300],0,2);
  expect(operations).toEqual([{type:'table.style',padding:16}]);
  expect(engine.execute({target:target(1,0,1,1),operations}).ok).toBe(true);
  expect(tableColumnWidths(table())).toEqual([100,200,300]);expect(table().child(1).child(2).attrs.padding).toBeNull();
});
it.each([0, -1, 1.5])('rejects an invalid cell span %s before opening a backup', colspan=>{
  const content={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan,rowspan:1},content:[{type:'paragraph'}]}]}]}]};
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid table',content}))).toThrow();
});
it('rejects mismatched column width metadata in a backup',()=>{
  const content={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2,rowspan:1,colwidth:[100]},content:[{type:'paragraph'}]}]}]}]};
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid widths',content}))).toThrow();
});

it.each(['left','center','right'] as const)('aligns a merged table %s without changing cells, widths or text, and undoes exactly',alignment=>{
  editor.commands.setContent('<table><tr><th colspan="2" colwidth="90,150">عنوان / Heading</th></tr><tr><td colwidth="90">日本語</td><td colwidth="150">العربية</td></tr></table>');
  const before=editor.getJSON(), cells=table().content.toJSON();
  expect(engine.execute({target:target(1,1),operations:[{type:'table.layout',alignment}]}).ok).toBe(true);
  expect(table().attrs.alignment).toBe(alignment); expect(table().content.toJSON()).toEqual(cells);
  const dom=editor.view.dom.querySelector('table')!;
  expect(dom.dataset.tableAlign).toBe(alignment);
  expect(dom.style.width).toBe('240px');
  expect([dom.style.marginLeft,dom.style.marginRight]).toEqual(alignment==='left'?['0px','auto']:alignment==='center'?['auto','auto']:['auto','0px']);
  expect(editor.getHTML()).toContain('width: 240px');
  expect(parseDocument(JSON.stringify({version:1,title:'Aligned',content:editor.getJSON()})).content).toEqual(editor.getJSON());
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});

it('changes only the requested border field in a mixed selection and retains it through HTML and undo',()=>{
  editor.commands.setContent('<table><tr><td style="border:2px dotted red" colwidth="90">A</td><td style="border:3px solid blue" colwidth="150">B</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:target(0,0),operations:[{type:'table.style',borderStyle:'dashed'}]}).ok).toBe(true);
  expect(table().child(0).child(0).attrs).toMatchObject({borderStyle:'dashed',borderWidth:2,borderColor:'red',colwidth:[90]});
  expect(table().child(0).child(1).attrs).toMatchObject({borderStyle:'solid',borderWidth:3,borderColor:'blue'});
  const html=editor.getHTML(); expect(html).toContain('border-style: dashed');
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  editor.commands.setContent(html); expect(table().child(0).child(0).attrs.borderStyle).toBe('dashed');
});

it('distributes selected rows including a contained rowspan, preserves unselected rows and undoes exactly',()=>{
  editor.commands.setContent('<table><tr><td rowspan="2" style="height:100px">Merged</td><td>A</td></tr><tr><td>B</td></tr><tr><td style="height:40px">C</td><td>D</td></tr></table>');
  const before=editor.getJSON(), last=table().child(2).toJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.distributeRows',from:0,to:2,height:70}]}).ok).toBe(true);
  expect([table().child(0).attrs.minHeight,table().child(1).attrs.minHeight]).toEqual([70,70]);
  expect(table().child(0).child(0).attrs).toMatchObject({rowspan:2,minHeight:null});
  expect(table().child(2).toJSON()).toEqual(last); expect(TableMap.get(table()).problems).toBeNull();
  expect(parseDocument(JSON.stringify({version:1,title:'Rows',content:editor.getJSON()})).content).toEqual(editor.getJSON());
  const after=editor.getJSON(); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  engine.history('redo'); expect(editor.getJSON()).toEqual(after);
});

it('rejects row distribution crossing an unselected merged row or invalid bounds atomically',()=>{
  editor.commands.setContent('<table><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td>B</td></tr></table>');
  const before=editor.getJSON();
  for (const [from,to] of [[0,1],[1,2],[1,1],[0,3]]) {
    expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},{type:'table.distributeRows',from,to,height:70}]}).ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  }
});

it('allows manual minimum height adjustment after distribution',()=>{
  editor.commands.setContent('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
  expect(engine.execute({target:target(),operations:[{type:'table.distributeRows',from:0,to:2,height:120}]}).ok).toBe(true);
  expect(engine.execute({target:target(0,0),operations:[{type:'table.style',minHeight:60}]}).ok).toBe(true);
  expect(table().child(0).attrs.minHeight).toBeNull(); expect(table().child(0).child(0).attrs.minHeight).toBe(60);
  expect(table().child(0).child(1).attrs.minHeight).toBeNull(); expect(table().child(1).attrs.minHeight).toBe(120);
});

it('removes a shared edge on both cells without changing other edges, then restores it with one undo',()=>{
  editor.commands.setContent('<table><tr><td style="border:2px solid #222222">A</td><td style="border:8px solid #222222">B</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.border',scope:'right',width:0,color:'#FF0000',style:'dashed'}]}).ok).toBe(true);
  const a=table().child(0).child(0).attrs,b=table().child(0).child(1).attrs;
  expect(cellBorder(a,'right').width).toBe(0);expect(cellBorder(b,'left').width).toBe(0);
  expect(cellBorder(a,'top').width).toBe(2);expect(cellBorder(b,'right').width).toBe(8);
  expect(parseDocument(JSON.stringify({version:1,title:'Borders',content:editor.getJSON()})).content).toEqual(editor.getJSON());
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});

it.each(['top','right','bottom','left','outer','inner','all'] as const)('sets %s borders on a rectangular selection, preserving content and column widths',scope=>{
  editor.commands.setContent('<table><tr><td colwidth="90">A</td><td colwidth="150">B</td></tr><tr><td colwidth="90">C</td><td colwidth="150">D</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:target(0,0,1,1),operations:[{type:'table.border',scope,width:3,color:'#FF0000',style:'dotted'}]}).ok).toBe(true);
  const first=table().child(0).child(0).attrs,last=table().child(1).child(1).attrs;
  const changed=(attrs:Record<string,unknown>,side:typeof borderSides[number])=>colorToHex(cellBorder(attrs,side).color)==='#FF0000';
  expect(changed(first,'top')).toBe(['all','outer','top'].includes(scope));
  expect(changed(last,'right')).toBe(['all','outer','right'].includes(scope));
  expect(changed(first,'right')).toBe(['all','inner'].includes(scope));
  expect(changed(last,'top')).toBe(['all','inner'].includes(scope));
  expect(tableColumnWidths(table())).toEqual([90,150]);expect(table().textContent).toBe('ABCD');
  const html=editor.getHTML();engine.history('undo');expect(editor.getJSON()).toEqual(before);
  editor.commands.setContent(html);expect(changed(table().child(0).child(0).attrs,'top')).toBe(['all','outer','top'].includes(scope));
});

it('rejects editing part of an adjacent merged edge atomically, and accepts the complete edge',()=>{
  editor.commands.setContent('<table><tr><td>A</td><td rowspan="2">Merged</td></tr><tr><td>B</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},{type:'table.border',scope:'right',width:2,color:'#FF0000',style:'solid'}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
  expect(engine.execute({target:target(0,0,1,0),operations:[{type:'table.border',scope:'right',width:2,color:'#FF0000',style:'solid'}]}).ok).toBe(true);
  expect(cellBorder(table().child(0).child(1).attrs,'left')).toMatchObject({width:2,color:'#FF0000'});
});

it('updates existing side overrides when uniform cell formatting changes',()=>{
  editor.commands.setContent('<table><tr><td>A</td><td>B</td></tr></table>');
  expect(engine.execute({target:target(),operations:[{type:'table.border',scope:'top',width:4,color:'#FF0000',style:'dotted'},{type:'table.style',borderColor:'#0000FF'}]}).ok).toBe(true);
  expect(cellBorder(table().child(0).child(0).attrs,'top')).toEqual({color:'#0000FF',width:4,style:'dotted'});
  expect(cellBorder(table().child(0).child(1).attrs,'left').color).toBe('#0000FF');
});

it('rejects invalid per-edge metadata before a backup can replace a document',()=>{
  editor.commands.setContent('<table><tr><td>A</td></tr></table>');
  const content: import('@tiptap/core').JSONContent=editor.getJSON();content.content![0].content![0].content![0].attrs!.borders={top:{width:-1,style:'solid',color:'#000000'}};
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content}))).toThrow('invalid cell borders');
});

it('keeps zero-width borders removed when HTML is pasted and serialized again',()=>{
  editor.commands.setContent('<table><tr><td style="border:0 none">No lines</td><td style="border-top:4px solid #FF0000;border-right:0px solid #000000">Mixed</td></tr></table>');
  const attrs=table().child(0).child(0).attrs;
  expect(borderSides.every(side=>cellBorder(attrs,side).width===0)).toBe(true);
  expect(cellBorder(table().child(0).child(1).attrs,'right').width).toBe(0);
  editor.commands.setContent(editor.getHTML());
  expect(borderSides.every(side=>cellBorder(table().child(0).child(0).attrs,side).width===0)).toBe(true);
  expect(cellBorder(table().child(0).child(1).attrs,'top').width).toBe(4);
});

it('keeps a rectangular selection for a context click inside it and retargets outside clicks before edits',()=>{
  editor.commands.setContent('<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr></table>');
  const tableBlock=engine.snapshot().blocks.find(b=>b.type==='table')!, start=tableBlock.from, map=TableMap.get(table());
  editor.commands.setCellSelection({anchorCell:start+map.map[0],headCell:start+map.map[1]});
  const selected=editor.state.selection;
  expect(tableContextSelection(editor.state,start+map.map[1]+1)).toBe(selected);
  const next=tableContextSelection(editor.state,start+map.map[5]+1)!;
  expect(next).not.toBeInstanceOf(CellSelection);
  editor.view.dispatch(editor.state.tr.setSelection(next));engine.captureSelection();
  expect(engine.execute({source:'toolbar',operations:[{type:'table.edit',action:'deleteRow'}]}).ok).toBe(true);
  expect(table().textContent).toBe('ABC');
  engine.history('undo');expect(table().textContent).toBe('ABCDEF');
});

it('retargets a context click in a different table without changing the original selected table',()=>{
  editor.commands.setContent('<table><tr><td>Original</td></tr></table><p>Between</p><table><tr><td>Target</td></tr></table>');
  const tables=engine.snapshot().blocks.filter(b=>b.type==='table');
  editor.commands.setCellSelection({anchorCell:tables[0].from+1});
  const next=tableContextSelection(editor.state,tables[1].from+2)!;
  editor.view.dispatch(editor.state.tr.setSelection(next));engine.captureSelection();
  expect(engine.execute({source:'toolbar',operations:[{type:'table.edit',action:'deleteTable'}]}).ok).toBe(true);
  expect(editor.getText()).toContain('Original');expect(editor.getText()).not.toContain('Target');
});

it('preserves selected text inside the clicked cell and ignores non-table context positions',()=>{
  editor.commands.setContent('<p>Before</p><table><tr><td>Selected text</td></tr></table>');
  const paragraph=engine.snapshot().blocks.find(b=>b.text==='Selected text'&&b.type==='paragraph')!;
  editor.commands.setTextSelection({from:paragraph.from,to:paragraph.from+8});
  expect(tableContextSelection(editor.state,paragraph.from)).toBe(editor.state.selection);
  expect(tableContextSelection(editor.state,1)).toBeNull();
  expect(tableContextSelection(editor.state,-1)).toBeNull();
});
